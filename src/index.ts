#!/usr/bin/env bun
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildCacheKey } from "./cache";
import { launchBrowser } from "./browser";
import { parseWithBrowser } from "./extract";
import { createLogger } from "./log";
import { formatValidationErrors, loadSchema } from "./schema";
import { runSchemaGenerator } from "./schema-generator";
import { SchemaValidationError, type ParseOptions } from "./types";
import { Progress } from "./progress";

const program = new Command();

program
  .name("yo-url-yo-json")
  .description("Generate schemas and parse URLs into schema-compliant JSON using CloakBrowser, llm-scraper, and Codex CLI.")
  .version("0.1.0");

program
  .command("parse")
  .requiredOption("--url <url>", "URL to parse")
  .requiredOption("--schema <path>", "JSON Schema file path or Zod schema module")
  .option("--cache-dir <path>", "Generated script cache directory", ".yo-url-yo-json/scripts")
  .option("--model <model>", "Codex model name", process.env.YOYJ_MODEL ?? "gpt-5.5")
  .option("--timeout-ms <ms>", "Extractor execution timeout", parsePositiveInt, 30_000)
  .option("--goto-timeout-ms <ms>", "Page navigation timeout", parsePositiveInt, 45_000)
  .option("--force-regenerate", "Skip cached script and generate a new extractor", false)
  .option("--headed", "Run CloakBrowser headed", false)
  .option("--verbose", "Print diagnostics to stderr", false)
  .action(async (rawOptions) => {
    if (shouldReexecParseUnderNode()) {
      reexecParseUnderNode(Boolean(rawOptions.verbose));
      return;
    }

    const options: ParseOptions = {
      url: normalizeUrl(rawOptions.url),
      schemaPath: resolve(rawOptions.schema),
      cacheDir: resolve(rawOptions.cacheDir),
      progressSteps: 11,
      model: rawOptions.model,
      timeoutMs: rawOptions.timeoutMs,
      gotoTimeoutMs: rawOptions.gotoTimeoutMs,
      forceRegenerate: Boolean(rawOptions.forceRegenerate),
      headed: Boolean(rawOptions.headed),
      verbose: Boolean(rawOptions.verbose),
    };

    const logger = createLogger(options.verbose);
    const progress = new Progress(options.verbose, options.progressSteps);
    let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;

    try {
      progress.step("Loading schema");
      const schemaBundle = await loadSchema(options.schemaPath);
      const key = buildCacheKey(options.url, schemaBundle.schema);

      progress.info(`schema source: ${schemaBundle.source}`);
      progress.info(`cache key: ${key.slug}`);

      progress.step("Starting CloakBrowser Docker container");
      browser = await launchBrowser({
        headed: options.headed,
        progress,
      });

      const data = await parseWithBrowser({
        browser,
        key,
        schemaBundle,
        options,
        logger,
        progress,
      });

      progress.step("Writing parsed JSON to stdout");
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } catch (error) {
      reportError(error);
      process.exitCode = 1;
    } finally {
      if (browser) {
        progress.step("Closing browser resources");
        await browser.close().catch(() => undefined);
      }
    }
  });

program
  .command("schema")
  .requiredOption("--out <path>", "Where to save the generated Zod schema module")
  .option("--prompt <text>", "Prompt describing the data to extract")
  .option("--url <url>", "Optional URL context for the schema generator")
  .option("--model <model>", "Codex model name", process.env.YOYJ_MODEL ?? "gpt-5.5")
  .option("--yes", "Save the first valid generated schema without interactive approval", false)
  .option("--verbose", "Print provider diagnostics to stderr", false)
  .action(async (rawOptions) => {
    try {
      await runSchemaGenerator({
        prompt: rawOptions.prompt,
        out: rawOptions.out,
        url: rawOptions.url ? normalizeUrl(rawOptions.url) : undefined,
        model: rawOptions.model,
        yes: Boolean(rawOptions.yes),
        verbose: Boolean(rawOptions.verbose),
      });
    } catch (error) {
      reportError(error);
      process.exitCode = 1;
    }
  });

await program.parseAsync();

function shouldReexecParseUnderNode(): boolean {
  return Boolean(process.versions.bun) && process.env.YOYJ_PARSE_NODE_REEXEC !== "1";
}

function reexecParseUnderNode(verbose: boolean): void {
  if (verbose) {
    console.error("[info] re-executing parse under Node for Playwright CDP compatibility");
  }

  const entrypoint = process.argv[1] ? resolve(process.argv[1]) : resolve("src/index.ts");
  const result = spawnSync("node", ["--import", "tsx", entrypoint, ...process.argv.slice(2)], {
    env: {
      ...process.env,
      YOYJ_PARSE_NODE_REEXEC: "1",
    },
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`Failed to re-execute parse under Node: ${result.error.message}`);
  }

  process.exitCode = result.status ?? 1;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
}

function reportError(error: unknown): void {
  if (error instanceof SchemaValidationError) {
    console.error(`${error.message} ${formatValidationErrors(error.errors)}`);
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
    return;
  }

  console.error(String(error));
}
