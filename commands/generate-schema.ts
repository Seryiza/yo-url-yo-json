#!/usr/bin/env bun
import { Command } from "commander";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSchemaGenerator } from "../src/schema-generator";

export async function runSchemaCli(argv = process.argv): Promise<void> {
  await createSchemaCommand()
    .name("generate-schema")
    .description("Generate a Zod schema module.")
    .parseAsync(argv);
}

export function createSchemaCommand(): Command {
  return new Command("schema")
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
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
}

function reportError(error: unknown): void {
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
  await runSchemaCli();
}
