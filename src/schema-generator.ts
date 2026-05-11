import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { generateObject } from "ai";
import * as z from "zod";
import { createCodexModel } from "./model";
import { loadSchema } from "./schema";
import type { JsonSchema } from "./types";
import { isJsonValue, WORKFLOW_EXTENSION_KEY } from "./workflow";

const generatedSchemaResponse = z.object({
  schemaJson: z.string().min(1),
  rationale: z.string().min(1),
});

export type GenerateSchemaOptions = {
  out: string;
  model: string;
  verbose: boolean;
};

export async function runSchemaGenerator(options: GenerateSchemaOptions): Promise<void> {
  const outPath = resolve(options.out);
  assertJsonSchemaPath(outPath);
  const prompt = await askRequired("Describe the data you want to extract: ");
  const rl = createInterface({ input, output });
  let feedback = "";
  let lastSchema: JsonSchema | null = null;

  try {
    while (true) {
      const draft = await generateSchemaDraft({
        prompt,
        model: options.model,
        verbose: options.verbose,
        feedback,
        previousSchema: lastSchema,
      });

      lastSchema = normalizeSchemaJson(draft.schemaJson);

      try {
        await validateGeneratedSchema(lastSchema);
      } catch (error) {
        throw new Error(
          [
            "Generated schema validation failed.",
            "Step: converting the generated JSON Schema with z.fromJSONSchema().",
            `Original error: ${formatError(error)}`,
            [
              "Run again with a prompt that asks for a plain draft 2020-12 JSON Schema using",
              "object, string, number, boolean, array, enum, and local $defs/$ref fields.",
            ].join(" "),
          ].join("\n"),
          { cause: error },
        );
      }

      output.write("\nGenerated schema:\n\n");
      output.write(`${formatJson(lastSchema)}\n\n`);
      output.write(`Rationale: ${draft.rationale}\n\n`);

      const suggestions = (
        await askWithReadline(rl, "Press Enter to save, or enter suggestions to regenerate: ")
      ).trim();

      if (!suggestions) {
        await saveSchema(outPath, lastSchema);
        output.write(`Saved schema to ${outPath}\n`);
        return;
      }

      feedback = suggestions;
    }
  } finally {
    rl.close();
  }
}

async function generateSchemaDraft(args: {
  prompt: string;
  model: string;
  verbose: boolean;
  feedback: string;
  previousSchema: JsonSchema | null;
}): Promise<z.infer<typeof generatedSchemaResponse>> {
  process.stderr.write("Generating schema with Codex...\n");

  try {
    const result = await generateObject({
      model: createCodexModel(args.model, args.verbose),
      schema: generatedSchemaResponse,
      system: [
        "You generate JSON Schema for a web parser.",
        "Return a JSON object with a `schemaJson` string containing the JSON Schema and a `rationale` string.",
        "`schemaJson` must be parseable JSON, not TypeScript and not Markdown.",
        "The schema must be a draft 2020-12 JSON Schema object.",
        "Include `$schema`: `https://json-schema.org/draft/2020-12/schema` at the schema root.",
        "Use only JSON Schema constructs that convert cleanly with z.fromJSONSchema().",
        "Do not use external $ref, unevaluatedProperties, unevaluatedItems, if, then, else, dependentSchemas, or dependentRequired.",
        "Prefer root type `object`, descriptive `description` fields, `required` for required fields, and `additionalProperties: false` for fixed objects.",
        "Use required fields unless the user clearly asks for optional fields.",
        `When the user asks for clicks, hovers, modal windows, scrolling, waiting, detail-page visits, per-item links, merging detail data, optional enrichment by link, or 404 verification, include a root \`${WORKFLOW_EXTENSION_KEY}\` object.`,
        `The \`${WORKFLOW_EXTENSION_KEY}\` object is metadata, not output data. It must use version 1 and a steps array.`,
        "Supported workflow steps: extract, click, hover, waitForSelector, scroll, goto, forEach, detail.",
        "Use extract steps for page-state extraction. Put partial extraction schemas on extract/detail steps when the workflow needs intermediate result links before producing the final output.",
        "When an extract step schema returns an object shaped like part of the final output, omit name/outputPath so the object merges into workflow state. Use outputPath like `$.items` when the extract step returns a bare array.",
        "For detail links, use a forEach step over the result items and a detail step with urlPath pointing at each item's link field.",
        "For repeated detail pages with URL ids, add routePattern such as `https://example.com/details/:id` so one reusable detail extractor can be generated and cached for that route.",
        "Use detail sampleSize only when the user asks for stronger coverage; otherwise omit it so the parser uses its default multi-sample behavior.",
        "For missing detail pages, support these behaviors: skip, keepWithStatus, errorBucket, keepWithStatusAndErrorBucket.",
        "Default missingDetailBehavior should be keepWithStatus unless the request clearly asks to omit missing items or collect errors separately.",
        "When 404 verification is requested, include compatible output fields such as detailStatus, detailOk, detailError, skippedCount, or errors as appropriate for the behavior.",
      ].join("\n"),
      prompt: [
        `User extraction request:\n${args.prompt}`,
        args.previousSchema ? `Previous schema draft:\n${formatJson(args.previousSchema)}` : "",
        args.feedback ? `Revision instructions:\n${args.feedback}` : "",
        "Generate the complete JSON Schema now.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    process.stderr.write("Schema draft generated.\n");
    return result.object;
  } catch (error) {
    throw new Error(
      [
        "Codex schema generation failed.",
        "Step: generating a JSON Schema draft with Codex CLI.",
        `Model: ${args.model}.`,
        `Original error: ${formatError(error)}`,
        "Common fixes: run `bun install` so @openai/codex is installed from this project, verify Codex auth with `codex login` or OPENAI_API_KEY, then retry with --verbose for provider logs.",
      ].join("\n"),
      { cause: error },
    );
  }
}

async function validateGeneratedSchema(schema: JsonSchema): Promise<void> {
  const tempDir = resolve(".yo-url-yo-json/tmp");
  const tempPath = resolve(tempDir, `schema-${randomUUID()}.json`);

  await mkdir(tempDir, { recursive: true });
  await writeFile(tempPath, `${formatJson(schema)}\n`, "utf8");

  try {
    await loadSchema(tempPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function saveSchema(outPath: string, schema: JsonSchema): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${formatJson(schema)}\n`, "utf8");
}

async function askRequired(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await askWithReadline(rl, question)).trim();
      if (answer) {
        return answer;
      }
    }
  } finally {
    rl.close();
  }
}

async function askWithReadline(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return rl.question(question);
}

function normalizeSchemaJson(schemaJson: string): JsonSchema {
  let schema: unknown;

  try {
    schema = JSON.parse(stripCodeFence(schemaJson));
  } catch (error) {
    throw new Error(`Generated schemaJson must be parseable JSON: ${formatError(error)}`);
  }

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("Generated schema must be a JSON object.");
  }

  if (!isJsonValue(schema)) {
    throw new Error("Generated schema must be valid JSON.");
  }

  return schema as JsonSchema;
}

function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function assertJsonSchemaPath(outPath: string): void {
  if (!outPath.endsWith(".json")) {
    throw new Error(`Generated schemas must be saved as .json files. Received: ${outPath}`);
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
