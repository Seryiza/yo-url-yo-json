import { setTimeout as delay } from "node:timers/promises";
import { jsonSchema, Output } from "ai";
import LLMScraper from "llm-scraper";
import type { Logger } from "./log";
import { validateData } from "./schema";
import type {
  CacheKey,
  ExtractFailureReason,
  ExtractionWorkflow,
  JsonSchema,
  MergeStrategy,
  MissingDetailBehavior,
  ParseOptions,
  SchemaBundle,
  WorkflowStep,
} from "./types";
import { createMetadata, readCachedScript, writeCachedScript } from "./cache";
import { createCodexModel } from "./model";
import type { Progress } from "./progress";

type BrowserLike = {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
};

type PageLike = {
  goto(url: string, options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle"; timeout?: number }): Promise<unknown>;
  evaluate(code: string): Promise<unknown>;
  click?(selector: string, options?: { timeout?: number }): Promise<unknown>;
  hover?(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForSelector?(
    selector: string,
    options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number },
  ): Promise<unknown>;
  close(): Promise<void>;
};

export async function parseWithBrowser(args: {
  browser: BrowserLike;
  key: CacheKey;
  schemaBundle: SchemaBundle;
  options: ParseOptions;
  logger: Logger;
  progress: Progress;
}): Promise<unknown> {
  args.progress.step("Opening browser page");
  const page = await args.browser.newPage();

  try {
    const targetUrl = args.schemaBundle.workflow?.startUrl ?? args.options.url;
    args.progress.step("Navigating to target URL");
    args.progress.info(`url: ${targetUrl}`);
    args.progress.status("Loading target page...");
    try {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: args.options.gotoTimeoutMs,
      });
      args.progress.status("Target page loaded.");
    } catch (error) {
      throw error;
    }

    if (args.schemaBundle.workflow) {
      args.progress.step("Running extraction workflow");
      const data = await runWorkflow({
        page,
        workflow: args.schemaBundle.workflow,
        schemaBundle: args.schemaBundle,
        options: args.options,
        progress: args.progress,
      });

      args.progress.step("Validating workflow output");
      const validated = validateData(args.schemaBundle, data, "Workflow output");
      args.progress.info("workflow output is schema-valid");
      return validated;
    }

    if (!args.options.forceRegenerate) {
      args.progress.step("Checking cached extractor");
      const cachedResult = await tryCachedScript({
        page,
        key: args.key,
        schemaBundle: args.schemaBundle,
        options: args.options,
        logger: args.logger,
        progress: args.progress,
      });

      if (cachedResult.ok) {
        args.progress.info("cached extractor returned schema-valid data");
        return cachedResult.data;
      }

      args.progress.info(`cached extractor unavailable: ${cachedResult.reason}`);
    } else {
      args.progress.step("Skipping cached extractor");
      args.progress.info("force-regenerate was set");
    }

    return await generateRunAndCache({
      page,
      key: args.key,
      schemaBundle: args.schemaBundle,
      options: args.options,
      logger: args.logger,
      progress: args.progress,
    });
  } finally {
    args.progress.info("closing page");
    await page.close().catch(() => undefined);
  }
}

async function tryCachedScript(args: {
  page: PageLike;
  key: CacheKey;
  schemaBundle: SchemaBundle;
  options: ParseOptions;
  logger: Logger;
  progress: Progress;
}): Promise<{ ok: true; data: unknown } | { ok: false; reason: ExtractFailureReason }> {
  const cached = await readCachedScript(args.options.cacheDir, args.key);
  if (!cached) {
    args.progress.info("cache miss: no generated extractor file found");
    return { ok: false, reason: "cache-miss" };
  }

  args.progress.info(`cache hit for origin: ${args.key.origin}`);

  args.progress.status("Running cached extractor...");
  try {
    const data = await withTimeout(args.page.evaluate(cached.code), args.options.timeoutMs);
    const validated = validateData(args.schemaBundle, data, "Cached extractor output");
    args.progress.status("Cached extractor output is schema-valid.");
    return { ok: true, data: validated };
  } catch (error) {
    if (error instanceof TimeoutError) {
      args.progress.warn("cached extractor timed out");
      return { ok: false, reason: "cached-script-timed-out" };
    }

    if (error instanceof Error && error.name === "SchemaValidationError") {
      args.progress.warn("cached extractor returned schema-invalid data");
      return { ok: false, reason: "cached-script-schema-invalid" };
    }

    args.progress.warn(`cached extractor failed: ${formatError(error)}`);
    return { ok: false, reason: "cached-script-threw" };
  }
}

async function generateRunAndCache(args: {
  page: PageLike;
  key: CacheKey;
  schemaBundle: SchemaBundle;
  options: ParseOptions;
  logger: Logger;
  progress: Progress;
}): Promise<unknown> {
  const cached = await readCachedScript(args.options.cacheDir, args.key);
  const scraper = new LLMScraper(createCodexModel(args.options.model, args.options.verbose));
  const output = Output.object({
    schema: jsonSchema(args.schemaBundle.outputSchema),
  });

  args.progress.step("Generating reusable Playwright extractor");
  args.progress.info(`model: ${args.options.model}`);
  args.progress.status("Generating Playwright extractor with Codex...");

  let generated: { code: unknown };
  try {
    generated = await scraper.generate(args.page, output, createGenerateOptions(args.options));
    args.progress.status("Playwright extractor generated.");
  } catch (error) {
    throw new Error(
      [
        "Codex extractor generation failed.",
        "Step: generating a reusable Playwright extractor with llm-scraper and Codex CLI.",
        `URL origin: ${args.key.origin}.`,
        `Model: ${args.options.model}.`,
        `Original error: ${formatError(error)}`,
        "Common fixes: run `bun install` so @openai/codex is installed from this project, verify Codex auth with `codex login` or OPENAI_API_KEY, then retry with --verbose for provider logs.",
      ].join("\n"),
      { cause: error },
    );
  }

  const code = normalizeGeneratedCode(generated.code);

  args.progress.step("Running generated extractor");
  args.progress.status("Executing generated extractor...");
  let data: unknown;
  try {
    data = await withTimeout(args.page.evaluate(code), args.options.timeoutMs);
    args.progress.status("Generated extractor executed.");
  } catch (error) {
    throw error;
  }

  args.progress.step("Validating extracted JSON");
  const validatedData = validateData(args.schemaBundle, data, "Generated extractor output");
  args.progress.info("generated extractor output is schema-valid");

  args.progress.step("Saving generated extractor");
  await writeCachedScript(
    args.options.cacheDir,
    args.key,
    code,
    createMetadata({
      key: args.key,
      url: args.options.url,
      model: args.options.model,
      previous: cached?.metadata,
    }),
  );
  args.progress.info(`saved extractor cache for ${args.key.slug}`);

  return validatedData;
}

async function runWorkflow(args: {
  page: PageLike;
  workflow: ExtractionWorkflow;
  schemaBundle: SchemaBundle;
  options: ParseOptions;
  progress: Progress;
}): Promise<unknown> {
  const state: Record<string, unknown> = {};
  const context: WorkflowContext = {
    state,
    currentItem: undefined,
    skippedCount: 0,
  };

  for (const step of args.workflow.steps) {
    await runWorkflowStep({
      ...args,
      step,
      context,
    });
  }

  const outputProperties = isRecord(args.schemaBundle.outputSchema.properties)
    ? args.schemaBundle.outputSchema.properties
    : {};
  if ((context.skippedCount > 0 || "skippedCount" in outputProperties) && state.skippedCount === undefined) {
    state.skippedCount = context.skippedCount;
  }
  if ("errors" in outputProperties && state.errors === undefined) {
    state.errors = [];
  }

  return state;
}

type WorkflowContext = {
  state: Record<string, unknown>;
  currentItem: unknown;
  skippedCount: number;
};

const SKIP_ITEM = Symbol("skip-item");

async function runWorkflowStep(args: {
  page: PageLike;
  workflow: ExtractionWorkflow;
  schemaBundle: SchemaBundle;
  options: ParseOptions;
  progress: Progress;
  step: WorkflowStep;
  context: WorkflowContext;
}): Promise<unknown> {
  switch (args.step.type) {
    case "extract": {
      const schema = args.step.schema ?? args.schemaBundle.outputSchema;
      args.progress.status(`Extracting${args.step.name ? ` ${args.step.name}` : ""}...`);
      const data = await generateAndRunExtractor({
        page: args.page,
        schema,
        options: args.options,
      });
      assignStepData(args.context.state, args.step, data);
      return data;
    }

    case "click": {
      assertPageMethod(args.page, "click");
      await args.page.click(args.step.selector, { timeout: args.step.timeoutMs ?? args.options.timeoutMs });
      return undefined;
    }

    case "hover": {
      assertPageMethod(args.page, "hover");
      await args.page.hover(args.step.selector, { timeout: args.step.timeoutMs ?? args.options.timeoutMs });
      return undefined;
    }

    case "waitForSelector": {
      assertPageMethod(args.page, "waitForSelector");
      await args.page.waitForSelector(args.step.selector, {
        state: args.step.state ?? "visible",
        timeout: args.step.timeoutMs ?? args.options.timeoutMs,
      });
      return undefined;
    }

    case "scroll": {
      await runScrollStep(args.page, args.step);
      return undefined;
    }

    case "goto": {
      const url = resolveWorkflowUrl(args.context, args.step.url, args.step.urlPath);
      const response = await args.page.goto(url, {
        waitUntil: args.step.waitUntil ?? "domcontentloaded",
        timeout: args.step.timeoutMs ?? args.options.gotoTimeoutMs,
      });
      const status = getResponseStatus(response);
      if (args.step.captureStatusAs) {
        assignPath(args.context.currentItem ?? args.context.state, args.step.captureStatusAs, status);
      }
      return status;
    }

    case "forEach": {
      const items = readPath(args.context.state, args.step.itemsPath);
      if (!Array.isArray(items)) {
        throw new Error(`Workflow forEach expected an array at ${args.step.itemsPath}.`);
      }

      const kept: unknown[] = [];
      for (const item of items) {
        const itemContext: WorkflowContext = {
          state: args.context.state,
          currentItem: item,
          skippedCount: args.context.skippedCount,
        };

        let skip = false;
        for (const childStep of args.step.steps) {
          const result = await runWorkflowStep({
            ...args,
            step: childStep,
            context: itemContext,
          });
          if (result === SKIP_ITEM) {
            skip = true;
            break;
          }
        }

        args.context.skippedCount = itemContext.skippedCount;
        if (!skip) {
          kept.push(item);
        }
      }

      assignPath(args.context.state, args.step.itemsPath, kept);
      return kept;
    }

    case "detail": {
      return runDetailStep({
        page: args.page,
        workflow: args.workflow,
        schemaBundle: args.schemaBundle,
        options: args.options,
        progress: args.progress,
        step: args.step,
        context: args.context,
      });
    }
  }
}

async function runDetailStep(args: {
  page: PageLike;
  workflow: ExtractionWorkflow;
  schemaBundle: SchemaBundle;
  options: ParseOptions;
  progress: Progress;
  step: Extract<WorkflowStep, { type: "detail" }>;
  context: WorkflowContext;
}): Promise<unknown> {
  const item = ensureObject(args.context.currentItem, "Workflow detail steps must run inside forEach.");
  const url = resolveWorkflowUrl(args.context, undefined, args.step.urlPath);
  const response = await args.page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: args.options.gotoTimeoutMs,
  });
  const status = getResponseStatus(response);
  const statusField = args.step.statusField ?? "detailStatus";
  const okField = args.step.okField ?? "detailOk";
  const errorField = args.step.errorField ?? "detailError";
  item[statusField] = status;

  if (status === 404) {
    const behavior = args.step.missingDetailBehavior ?? args.workflow.missingDetailBehavior ?? "keepWithStatus";
    item[okField] = false;
    item[errorField] = "not_found";
    handleMissingDetail({
      behavior,
      workflow: args.workflow,
      state: args.context.state,
      item,
      url,
      status,
      reason: "not_found",
    });

    if (behavior === "skip" || behavior === "errorBucket") {
      args.context.skippedCount += 1;
      return SKIP_ITEM;
    }

    return item;
  }

  item[okField] = true;
  if (!args.step.schema) {
    return item;
  }

  args.progress.status(`Extracting detail from ${url}...`);
  const detailData = await generateAndRunExtractor({
    page: args.page,
    schema: args.step.schema,
    options: args.options,
  });
  mergeDetailData({
    item,
    detailData,
    step: args.step,
    workflow: args.workflow,
  });
  return item;
}

async function generateAndRunExtractor(args: {
  page: PageLike;
  schema: JsonSchema;
  options: ParseOptions;
}): Promise<unknown> {
  const scraper = new LLMScraper(createCodexModel(args.options.model, args.options.verbose));
  const output = Output.object({
    schema: jsonSchema(args.schema),
  });
  const generated = await scraper.generate(args.page, output, createGenerateOptions(args.options));
  const code = normalizeGeneratedCode(generated.code);
  return withTimeout(args.page.evaluate(code), args.options.timeoutMs);
}

function createGenerateOptions(options: ParseOptions) {
  return {
    system: [
      "Provide a scraping function in JavaScript that extracts and returns data according to a schema from the current page state.",
      "The function must be an IIFE. No comments, imports, or console.log. Output only runnable code.",
      "Do not perform cross-page navigation. The host application owns clicks, hovers, waits, modal opening, pagination, status checks, and page navigation with Playwright.",
      "Read data from the DOM state that already exists when the function runs, including visible modals, tooltips, expanded panels, and hidden machine-readable metadata.",
      "Return exactly one schema-compliant value.",
    ].join("\n"),
    // Codex CLI does not support AI SDK sampling controls such as temperature.
    // If this project adds an OpenAI-compatible provider later, set provider-specific
    // generation settings there instead of passing them to Codex.
  } satisfies Parameters<LLMScraper["generate"]>[2];
}

function assignStepData(target: Record<string, unknown>, step: Extract<WorkflowStep, { type: "extract" }>, data: unknown): void {
  if (step.outputPath) {
    assignPath(target, step.outputPath, data);
    return;
  }

  if (step.name) {
    target[step.name] = data;
    return;
  }

  if (isRecord(data)) {
    Object.assign(target, data);
    return;
  }

  target.data = data;
}

async function runScrollStep(page: PageLike, step: Extract<WorkflowStep, { type: "scroll" }>): Promise<void> {
  await page.evaluate(
    `(${({ selector, x, y }: { selector?: string; x: number; y: number }) => {
      const target = selector ? document.querySelector(selector) : window;
      if (!target) {
        throw new Error(`Scroll target not found: ${selector}`);
      }
      if (target === window) {
        window.scrollBy(x, y);
      } else {
        (target as Element).scrollBy(x, y);
      }
    }})(${JSON.stringify({ selector: step.selector, x: step.x ?? 0, y: step.y ?? 800 })})`,
  );
}

function handleMissingDetail(args: {
  behavior: MissingDetailBehavior;
  workflow: ExtractionWorkflow;
  state: Record<string, unknown>;
  item: Record<string, unknown>;
  url: string;
  status: number | null;
  reason: string;
}): void {
  if (args.behavior !== "errorBucket" && args.behavior !== "keepWithStatusAndErrorBucket") {
    return;
  }

  const errorsPath = args.workflow.errorsPath ?? "$.errors";
  const existing = readPath(args.state, errorsPath);
  const errors = Array.isArray(existing) ? existing : [];
  errors.push({
    url: args.url,
    status: args.status,
    reason: args.reason,
    item: { ...args.item },
  });
  assignPath(args.state, errorsPath, errors);
}

function mergeDetailData(args: {
  item: Record<string, unknown>;
  detailData: unknown;
  step: Extract<WorkflowStep, { type: "detail" }>;
  workflow: ExtractionWorkflow;
}): void {
  if (args.step.outputPath) {
    assignPath(args.item, args.step.outputPath, args.detailData);
    return;
  }

  if (args.step.name) {
    args.item[args.step.name] = args.detailData;
    return;
  }

  const strategy: MergeStrategy = args.step.mergeStrategy ?? args.workflow.mergeStrategy ?? "merge";
  if (strategy === "nest") {
    args.item.detail = args.detailData;
    return;
  }

  if (isRecord(args.detailData)) {
    Object.assign(args.item, args.detailData);
    return;
  }

  args.item.detail = args.detailData;
}

function resolveWorkflowUrl(context: WorkflowContext, url?: string, path?: string): string {
  const value = url ?? (path ? readPath(context.currentItem ?? context.state, path) : undefined);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(path ? `Workflow URL path ${path} did not resolve to a string.` : "Workflow step requires a URL.");
  }
  return value;
}

function readPath(source: unknown, path: string): unknown {
  const parts = parsePath(path);
  let current = source;
  for (const part of parts) {
    if (current == null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function assignPath(target: unknown, path: string, value: unknown): void {
  const parts = parsePath(path);
  if (!parts.length) {
    throw new Error(`Invalid empty workflow path: ${path}`);
  }

  let current = ensureObject(target, `Workflow path ${path} must start at an object.`);
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

function parsePath(path: string): string[] {
  const normalized = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;
  return normalized
    .split(".")
    .flatMap((part) => [...part.matchAll(/[^\[\]]+|\[(\d+)\]/g)].map((match) => match[1] ?? match[0]))
    .filter(Boolean);
}

function assertPageMethod<K extends "click" | "hover" | "waitForSelector">(
  page: PageLike,
  method: K,
): asserts page is PageLike & Required<Pick<PageLike, K>> {
  if (typeof page[method] !== "function") {
    throw new Error(`Workflow step requires Playwright page.${method}().`);
  }
}

function getResponseStatus(response: unknown): number | null {
  if (response && typeof response === "object" && "status" in response) {
    const status = (response as { status?: unknown }).status;
    if (typeof status === "function") {
      const value = status.call(response);
      return typeof value === "number" ? value : null;
    }
  }

  return null;
}

function ensureObject(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeGeneratedCode(code: unknown): string {
  if (typeof code !== "string" || !code.trim()) {
    throw new Error("llm-scraper returned an empty generated script.");
  }

  return code.trimEnd();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = delay(timeoutMs).then(() => {
    throw new TimeoutError(`operation timed out after ${timeoutMs}ms`);
  });

  return Promise.race([promise, timeout]);
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
