#!/usr/bin/env bun
import { Command } from "commander";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSchemaCommand } from "./generate-schema";
import { createParseCommand } from "./parse";

export async function runCli(argv = process.argv): Promise<void> {
  await createRootCommand().parseAsync(argv);
}

export function createRootCommand(): Command {
  return new Command()
    .name("yo-url-yo-json")
    .description("Extract validated JSON from webpages using JSON Schema.")
    .addCommand(createParseCommand())
    .addCommand(createSchemaCommand());
}

function isMainModule(url: string): boolean {
  return process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href === url : false;
}

if (isMainModule(import.meta.url)) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
