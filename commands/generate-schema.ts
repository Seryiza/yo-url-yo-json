#!/usr/bin/env bun
import { Command } from "commander";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSchemaGenerator } from "../src/schema-generator";

export async function runSchemaCli(argv = process.argv): Promise<void> {
  await createSchemaCommand()
    .name("generate-schema")
    .description("Generate a JSON Schema file.")
    .parseAsync(argv);
}

export function createSchemaCommand(): Command {
  return new Command("schema")
    .requiredOption("--out <path>", "Where to save the generated .json JSON Schema file")
    .option("--model <model>", "Codex model name", process.env.YOYJ_MODEL ?? "gpt-5.5")
    .option("--verbose", "Print provider diagnostics to stderr", false)
    .action(async (rawOptions) => {
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
  return process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href === url : false;
}

if (isMainModule(import.meta.url)) {
  await runSchemaCli();
}
