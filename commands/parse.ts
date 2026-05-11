#!/usr/bin/env bun
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildCacheKey } from "../src/cache";
import { launchBrowser } from "../src/browser";
import { parseWithBrowser } from "../src/extract";
import { createLogger } from "../src/log";
import { formatValidationErrors, loadSchema } from "../src/schema";
import { SchemaValidationError, type ParseOptions } from "../src/types";
import { Progress } from "../src/progress";

export async function runParseCli(argv = process.argv): Promise<void> {
  await createParseCommand()
    .name("parse")
    .description("Parse a URL into schema-compliant JSON.")
    .parseAsync(argv);
}

export function createParseCommand(): Command {
  return new Command("parse")
    .requiredOption("--url <url>", "URL to parse")
    .requiredOption("--schema <path>", ".json JSON Schema file path")
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

        progress.info("schema format: json-schema");
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
}

function shouldReexecParseUnderNode(): boolean {
  return Boolean(process.versions.bun) && process.env.YOYJ_PARSE_NODE_REEXEC !== "1";
}

function reexecParseUnderNode(verbose: boolean): void {
  if (verbose) {
    console.error("[info] re-executing parse under Node for Playwright CDP compatibility");
  }

  const entrypoint = process.argv[1] ? resolve(process.argv[1]) : resolve("commands/parse.ts");
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

function isMainModule(url: string): boolean {
  return process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href === url : false;
}

if (isMainModule(import.meta.url)) {
  await runParseCli();
}
