#!/usr/bin/env bun
import { Command } from "commander";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { configureAiSdkWarnings } from "../src/ai-sdk-warnings";
import { runSchemaGenerator } from "../src/schema-generator";

export async function runSchemaCli(argv = process.argv): Promise<void> {
  await createSchemaCommand()
    .description("Generate a JSON Schema file with optional extraction workflow metadata.")
    .parseAsync(argv);
}

export function createSchemaCommand(): Command {
  return new Command("generate-schema")
    .description("Generate a JSON Schema file with optional extraction workflow metadata.")
    .requiredOption("--out <path>", "Where to save the generated .json JSON Schema file")
    .option("--model <model>", "Codex model name", process.env.YOYJ_MODEL ?? "gpt-5.5")
    .option("--verbose", "Print provider diagnostics to stderr", false)
    .action(async (rawOptions) => {
      configureAiSdkWarnings(Boolean(rawOptions.verbose));

      try {
        await runSchemaGenerator({
          out: rawOptions.out,
          model: rawOptions.model,
          verbose: Boolean(rawOptions.verbose),
        });
      } catch (error) {
        reportError(error);
        process.exitCode = 1;
      }
    });
}

function reportError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.message);
    return;
  }

  console.error(String(error));
}

function isMainModule(url: string): boolean {
  if (!process.argv[1] || isBundledRootEntrypoint(process.argv[1])) {
    return false;
  }

  return pathToFileURL(resolve(process.argv[1])).href === url;
}

function isBundledRootEntrypoint(entrypoint: string): boolean {
  const name = basename(entrypoint);
  return name === "yo-url-yo-json" || name === "yo-url-yo-json.js" || name === "yo-url-yo-json-node.js";
}

if (isMainModule(import.meta.url)) {
  runSchemaCli().catch((error: unknown) => {
    reportError(error);
    process.exitCode = 1;
  });
}
