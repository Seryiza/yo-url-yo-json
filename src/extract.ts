import { setTimeout as delay } from "node:timers/promises";
import { jsonSchema, Output } from "ai";
import LLMScraper from "llm-scraper";
import type { Logger } from "./log";
import { validateData, validateJsonSchemaData } from "./schema";
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
import { buildWorkflowDetailCacheKey, createMetadata, inferRoutePattern, readCachedScript, writeCachedScript } from "./cache";
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

const DETAIL_SAMPLE_HTML_CHAR_LIMIT = 120_000;

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
    detailExtractorCache: new Map(),
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
  collectionItems?: unknown[];
  detailExtractorCache: Map<string, string>;
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
          collectionItems: items,
          detailExtractorCache: args.context.detailExtractorCache,
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
  const detailData = await runDetailExtractorWithCache({
    page: args.page,
    workflow: args.workflow,
    step: args.step,
    context: args.context,
    schema: args.step.schema,
    url,
    options: args.options,
    progress: args.progress,
  });
  mergeDetailData({
    item,
    detailData,
    step: args.step,
    workflow: args.workflow,
  });
  return item;
}

async function runDetailExtractorWithCache(args: {
  page: PageLike;
  workflow: ExtractionWorkflow;
  step: Extract<WorkflowStep, { type: "detail" }>;
  context: WorkflowContext;
  schema: JsonSchema;
  url: string;
  options: ParseOptions;
  progress: Progress;
}): Promise<unknown> {
  if ((args.step.cachePolicy ?? "route") === "none") {
    const data = await generateAndRunExtractor({
      page: args.page,
      schema: args.schema,
      options: args.options,
    });
    return validateJsonSchemaData(args.schema, data, "Detail extractor output");
  }

  const codeResult = await getOrCreateDetailExtractorCode(args);
  if (codeResult.pageNeedsReload) {
    await gotoDetailUrl(args.page, args.url, args.options);
  }

  try {
    const data = await runExtractorCode(args.page, codeResult.code, args.options);
    return validateJsonSchemaData(args.schema, data, "Detail extractor output");
  } catch (error) {
    if (!shouldRegenerateDetailExtractor(args.step, error)) {
      throw error;
    }

    args.progress.warn("cached detail extractor returned schema-invalid data; regenerating with current page included");
    const regenerated = await generateAndCacheDetailExtractor({
      ...args,
      force: true,
      requiredSampleUrls: [args.url],
    });
    await gotoDetailUrl(args.page, args.url, args.options);
    const data = await runExtractorCode(args.page, regenerated.code, args.options);
    return validateJsonSchemaData(args.schema, data, "Regenerated detail extractor output");
  }
}

async function getOrCreateDetailExtractorCode(args: {
  page: PageLike;
  workflow: ExtractionWorkflow;
  step: Extract<WorkflowStep, { type: "detail" }>;
  context: WorkflowContext;
  schema: JsonSchema;
  url: string;
  options: ParseOptions;
  progress: Progress;
}): Promise<{ code: string; pageNeedsReload: boolean }> {
  const routePattern = resolveDetailRoutePattern(args.step, args.url);
  const cacheRoutePattern = resolveDetailCacheRoutePattern(args.step, routePattern);
  const key = buildWorkflowDetailCacheKey({
    url: args.url,
    schema: args.schema,
    model: args.options.model,
    routePattern: cacheRoutePattern,
    codegenKey: args.step.codegenKey,
  });

  const cachedInRun = args.context.detailExtractorCache.get(key.slug);
  if (cachedInRun) {
    args.progress.info(`detail extractor cache hit in current run: ${key.slug}`);
    return { code: cachedInRun, pageNeedsReload: false };
  }

  if (!args.options.forceRegenerate) {
    const cached = await readCachedScript(args.options.cacheDir, key);
    if (cached) {
      args.context.detailExtractorCache.set(key.slug, cached.code);
      args.progress.info(`detail extractor cache hit: ${key.slug}`);
      return { code: cached.code, pageNeedsReload: false };
    }
  }

  const generated = await generateAndCacheDetailExtractor({
    ...args,
    force: false,
    requiredSampleUrls: [],
  });
  args.context.detailExtractorCache.set(key.slug, generated.code);
  return { code: generated.code, pageNeedsReload: true };
}

async function generateAndCacheDetailExtractor(args: {
  page: PageLike;
  workflow: ExtractionWorkflow;
  step: Extract<WorkflowStep, { type: "detail" }>;
  context: WorkflowContext;
  schema: JsonSchema;
  url: string;
  options: ParseOptions;
  progress: Progress;
  force: boolean;
  requiredSampleUrls: string[];
}): Promise<{ code: string }> {
  const routePattern = resolveDetailRoutePattern(args.step, args.url);
  const cacheRoutePattern = resolveDetailCacheRoutePattern(args.step, routePattern);
  const key = buildWorkflowDetailCacheKey({
    url: args.url,
    schema: args.schema,
    model: args.options.model,
    routePattern: cacheRoutePattern,
    codegenKey: args.step.codegenKey,
  });
  const sampleUrls = selectDetailSampleUrls({
    context: args.context,
    step: args.step,
    currentUrl: args.url,
    routePattern,
    requiredSampleUrls: args.requiredSampleUrls,
  }).slice(0, args.step.sampleSize ?? 3);

  args.progress.status(`Generating detail extractor for route ${routePattern} from ${sampleUrls.length} sample(s)...`);
  const samples = await collectDetailSamples({
    page: args.page,
    urls: sampleUrls,
    options: args.options,
    progress: args.progress,
  });

  if (!samples.length) {
    throw new Error(`Cannot generate detail extractor for ${routePattern}: no non-404 sample pages were available.`);
  }

  args.progress.info(
    `detail codegen samples: ${samples
      .map((sample) => `${sample.url} (${sample.html.length}/${sample.originalHtmlLength} chars${sample.truncated ? ", truncated" : ""})`)
      .join("; ")}`,
  );

  const code = await generateExtractorCode({
    page: args.page,
    schema: args.schema,
    options: args.options,
    sampleContent: formatDetailSamples(samples),
  });

  await validateDetailExtractorOnSamples({
    page: args.page,
    schema: args.schema,
    code,
    samples,
    options: args.options,
  });

  const previous = args.force ? await readCachedScript(args.options.cacheDir, key) : null;
  await writeCachedScript(
    args.options.cacheDir,
    key,
    code,
    createMetadata({
      key,
      url: args.url,
      model: args.options.model,
      previous: previous?.metadata,
      kind: "workflow-detail",
      routePattern,
      codegenKey: args.step.codegenKey,
      workflowStep: args.step.name ?? args.step.outputPath ?? args.step.urlPath,
      sampleUrls: samples.map((sample) => sample.url),
      sampleStatuses: samples.map((sample) => sample.status),
    }),
  );
  args.context.detailExtractorCache.set(key.slug, code);
  args.progress.info(`saved detail extractor cache for ${key.slug}`);

  return { code };
}

async function generateAndRunExtractor(args: {
  page: PageLike;
  schema: JsonSchema;
  options: ParseOptions;
}): Promise<unknown> {
  const code = await generateExtractorCode(args);
  return runExtractorCode(args.page, code, args.options);
}

async function generateExtractorCode(args: {
  page: PageLike;
  schema: JsonSchema;
  options: ParseOptions;
  sampleContent?: string;
}): Promise<string> {
  const scraper = new LLMScraper(createCodexModel(args.options.model, args.options.verbose));
  const output = Output.object({
    schema: jsonSchema(args.schema),
  });
  const page = args.sampleContent === undefined ? args.page : createStaticGenerationPage(args.sampleContent);
  try {
    const generated = await scraper.generate(page, output, createGenerateOptions(args.options));
    return normalizeGeneratedCode(generated.code);
  } catch (error) {
    throw new Error(
      [
        "Codex extractor code generation failed.",
        `Input: ${args.sampleContent === undefined ? "current page" : "multi-sample detail pages"}.`,
        `Model: ${args.options.model}.`,
        `Original error: ${formatError(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

async function runExtractorCode(page: PageLike, code: string, options: ParseOptions): Promise<unknown> {
  return withTimeout(page.evaluate(code), options.timeoutMs);
}

type DetailSample = {
  url: string;
  status: number | null;
  html: string;
  originalHtmlLength: number;
  truncated: boolean;
};

async function collectDetailSamples(args: {
  page: PageLike;
  urls: string[];
  options: ParseOptions;
  progress: Progress;
}): Promise<DetailSample[]> {
  const samples: DetailSample[] = [];

  for (const url of args.urls) {
    args.progress.info(`loading detail codegen sample: ${url}`);
    const response = await gotoDetailUrl(args.page, url, args.options);
    const status = getResponseStatus(response);
    args.progress.info(`detail sample status: ${status ?? "unknown"} for ${url}`);
    if (status === 404) {
      continue;
    }

    const html = await readCurrentPageHtml(args.page, args.options.truncateLongHtmlForLlm);
    if (html.oversized) {
      throw new Error(
        [
          "Detail sample HTML is too large for Codex code generation after cleanup.",
          `URL: ${url}`,
          `Cleaned HTML length: ${html.originalLength} characters.`,
          `Limit: ${DETAIL_SAMPLE_HTML_CHAR_LIMIT} characters.`,
          "Re-run parse with `--truncate-long-html-for-llm` to allow truncation, or reduce detail sampleSize / narrow the workflow route.",
        ].join("\n"),
      );
    }
    samples.push({
      url,
      status,
      html: html.html,
      originalHtmlLength: html.originalLength,
      truncated: html.truncated,
    });
  }

  return samples;
}

async function validateDetailExtractorOnSamples(args: {
  page: PageLike;
  schema: JsonSchema;
  code: string;
  samples: DetailSample[];
  options: ParseOptions;
}): Promise<void> {
  for (const sample of args.samples) {
    await gotoDetailUrl(args.page, sample.url, args.options);
    const data = await runExtractorCode(args.page, args.code, args.options);
    validateJsonSchemaData(args.schema, data, `Detail sample extractor output for ${sample.url}`);
  }
}

async function gotoDetailUrl(page: PageLike, url: string, options: ParseOptions): Promise<unknown> {
  return page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: options.gotoTimeoutMs,
  });
}

async function readCurrentPageHtml(
  page: PageLike,
  allowTruncation: boolean,
): Promise<{ html: string; originalLength: number; truncated: boolean; oversized: boolean }> {
  const result = await page.evaluate(
    `(() => {
      const source = document.documentElement ?? document.body;
      if (!source) {
        return { html: "", originalLength: 0, truncated: false, oversized: false };
      }

      const clone = source.cloneNode(true);
      const elementsToRemove = [
        "script",
        "style",
        "noscript",
        "iframe",
        "svg",
        "img",
        "audio",
        "video",
        "canvas",
        "map",
        "source",
        "dialog",
        "menu",
        "menuitem",
        "track",
        "object",
        "embed",
        "form",
        "input",
        "button",
        "select",
        "textarea",
        "label",
        "option",
        "optgroup",
        "aside",
        "footer",
        "header",
        "nav",
        "head",
      ];
      const attributesToRemove = ["style", "src", "alt", "title", "role", "aria-", "tabindex", "on", "data-"];
      clone.querySelectorAll(elementsToRemove.join(",")).forEach((element) => element.remove());
      clone.querySelectorAll("*").forEach((element) => {
        for (const attr of Array.from(element.attributes)) {
          if (attributesToRemove.some((prefix) => attr.name.startsWith(prefix))) {
            element.removeAttribute(attr.name);
          }
        }
      });

      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
      const comments = [];
      while (walker.nextNode()) {
        comments.push(walker.currentNode);
      }
      comments.forEach((comment) => comment.parentNode?.removeChild(comment));

      const originalHtml = clone.outerHTML.replace(/\\s+/g, " ").trim();
      const limit = ${DETAIL_SAMPLE_HTML_CHAR_LIMIT};
      const allowTruncation = ${JSON.stringify(allowTruncation)};
      if (originalHtml.length > limit && !allowTruncation) {
        return {
          html: "",
          originalLength: originalHtml.length,
          truncated: false,
          oversized: true,
        };
      }
      return {
        html: originalHtml.length > limit ? originalHtml.slice(0, limit) : originalHtml,
        originalLength: originalHtml.length,
        truncated: originalHtml.length > limit,
        oversized: false,
      };
    })()`,
  );
  if (isRecord(result) && typeof result.html === "string" && typeof result.originalLength === "number") {
    return {
      html: result.html,
      originalLength: result.originalLength,
      truncated: result.truncated === true,
      oversized: result.oversized === true,
    };
  }

  return { html: "", originalLength: 0, truncated: false, oversized: false };
}

function formatDetailSamples(samples: DetailSample[]): string {
  return samples
    .map((sample, index) =>
      [
        `Sample ${index + 1}`,
        `URL: ${sample.url}`,
        `HTTP status: ${sample.status ?? "unknown"}`,
        `HTML: cleaned${sample.truncated ? ` and truncated from ${sample.originalHtmlLength} to ${sample.html.length} characters` : ""}`,
        sample.html,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

function createStaticGenerationPage(content: string): PageLike {
  return {
    async goto() {
      return null;
    },
    async evaluate() {
      return undefined;
    },
    async close() {
      return undefined;
    },
    content: async () => content,
    url: () => "about:blank",
  } as PageLike & { content(): Promise<string>; url(): string };
}

function selectDetailSampleUrls(args: {
  context: WorkflowContext;
  step: Extract<WorkflowStep, { type: "detail" }>;
  currentUrl: string;
  routePattern: string;
  requiredSampleUrls: string[];
}): string[] {
  const urls = new Set<string>();
  for (const url of [...args.requiredSampleUrls, args.currentUrl]) {
    urls.add(url);
  }

  for (const item of args.context.collectionItems ?? []) {
    const value = readPath(item, args.step.urlPath);
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }

    if (isDetailUrlInSameGroup(value, args.step, args.routePattern)) {
      urls.add(value);
    }
  }

  return [...urls];
}

function isDetailUrlInSameGroup(url: string, step: Extract<WorkflowStep, { type: "detail" }>, routePattern: string): boolean {
  try {
    new URL(url);
  } catch {
    return false;
  }

  if (step.codegenKey) {
    return true;
  }

  if (step.routePattern) {
    return routeMatchesPattern(url, step.routePattern);
  }

  return inferRoutePattern(url) === routePattern;
}

function resolveDetailRoutePattern(step: Extract<WorkflowStep, { type: "detail" }>, url: string): string {
  return step.routePattern ?? inferRoutePattern(url);
}

function resolveDetailCacheRoutePattern(step: Extract<WorkflowStep, { type: "detail" }>, routePattern: string): string {
  return step.codegenKey ? `codegen:${step.codegenKey}` : routePattern;
}

function routeMatchesPattern(url: string, pattern: string): boolean {
  const parsedUrl = new URL(url);
  const normalizedPattern = normalizeRoutePattern(pattern);
  const target = normalizedPattern.hasOrigin
    ? `${parsedUrl.origin.toLowerCase()}${normalizeRoutePath(parsedUrl.pathname)}`
    : normalizeRoutePath(parsedUrl.pathname);
  const patternText = normalizedPattern.value.replace(/:[A-Za-z_][A-Za-z0-9_-]*/g, "\0");
  const regexText = `^${patternText
    .split("\0")
    .map(escapeRegex)
    .join("[^/]+")}$`;

  return new RegExp(regexText).test(target);
}

function normalizeRoutePattern(pattern: string): { value: string; hasOrigin: boolean } {
  try {
    const parsed = new URL(pattern);
    return {
      value: `${parsed.origin.toLowerCase()}${normalizeRoutePath(parsed.pathname)}`,
      hasOrigin: true,
    };
  } catch {
    return {
      value: normalizeRoutePath(pattern.startsWith("/") ? pattern : `/${pattern}`),
      hasOrigin: false,
    };
  }
}

function normalizeRoutePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path || "/";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldRegenerateDetailExtractor(step: Extract<WorkflowStep, { type: "detail" }>, error: unknown): boolean {
  return (step.regenerateOnSchemaFailure ?? true) && error instanceof Error && error.name === "SchemaValidationError";
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
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details = extractProviderErrorDetails(error);
  return details ? `${error.message}\n${details}` : error.message;
}

function extractProviderErrorDetails(error: Error): string {
  const data = (error as Error & { data?: unknown }).data;
  if (!isRecord(data)) {
    return "";
  }

  const parts: string[] = [];
  if (typeof data.exitCode === "number") {
    parts.push(`Codex CLI exit code: ${data.exitCode}`);
  }
  if (typeof data.stderr === "string" && data.stderr.trim()) {
    parts.push(`Codex CLI stderr:\n${limitDiagnosticText(data.stderr.trim(), 4_000)}`);
  }
  if (typeof data.promptExcerpt === "string" && data.promptExcerpt.trim()) {
    parts.push(`Prompt excerpt:\n${limitDiagnosticText(data.promptExcerpt.trim(), 1_000)}`);
  }

  return parts.join("\n");
}

function limitDiagnosticText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n... truncated ${value.length - limit} chars` : value;
}
