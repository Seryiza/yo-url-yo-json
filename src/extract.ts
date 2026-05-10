import { setTimeout as delay } from "node:timers/promises";
import { jsonSchema, Output } from "ai";
import LLMScraper from "llm-scraper";
import type { Logger } from "./log";
import { validateData } from "./schema";
import type { CacheKey, ExtractFailureReason, ParseOptions, SchemaBundle } from "./types";
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
    args.progress.step("Navigating to target URL");
    args.progress.info(`url: ${args.options.url}`);
    const navigate = args.progress.spinner("Loading target page");
    navigate.start();
    try {
      await page.goto(args.options.url, {
        waitUntil: "domcontentloaded",
        timeout: args.options.gotoTimeoutMs,
      });
      navigate.stop("Target page loaded.");
    } catch (error) {
      navigate.stop();
      throw error;
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

  const spinner = args.progress.spinner("Running cached extractor");
  try {
    spinner.start();
    const data = await withTimeout(args.page.evaluate(cached.code), args.options.timeoutMs);
    const validated = validateData(args.schemaBundle, data, "Cached extractor output");
    spinner.stop("Cached extractor output is schema-valid.");
    return { ok: true, data: validated };
  } catch (error) {
    spinner.stop();
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
    schema: jsonSchema(args.schemaBundle.schema),
  });

  args.progress.step("Generating reusable Playwright extractor");
  args.progress.info(`model: ${args.options.model}`);
  const spinner = args.progress.spinner("Generating Playwright extractor with Codex");
  spinner.start();

  let generated: { code: unknown };
  try {
    generated = await scraper.generate(args.page, output);
    spinner.stop("Playwright extractor generated.");
  } catch (error) {
    spinner.stop();
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
  const runGenerated = args.progress.spinner("Executing generated extractor");
  runGenerated.start();
  let data: unknown;
  try {
    data = await withTimeout(args.page.evaluate(code), args.options.timeoutMs);
    runGenerated.stop("Generated extractor executed.");
  } catch (error) {
    runGenerated.stop();
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
