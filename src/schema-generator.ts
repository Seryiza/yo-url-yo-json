import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { generateObject } from "ai";
import * as z from "zod";
import { createCodexModel } from "./model";
import { loadSchema } from "./schema";
import { Spinner } from "./spinner";

const generatedSchemaResponse = z.object({
  source: z.string().min(1),
  rationale: z.string().min(1),
});

export type GenerateSchemaOptions = {
  out: string;
  model: string;
  verbose: boolean;
};

export async function runSchemaGenerator(options: GenerateSchemaOptions): Promise<void> {
  const prompt = await askRequired("Describe the data you want to extract: ");
  const outPath = resolve(options.out);
  const rl = createInterface({ input, output });
  let feedback = "";
  let lastSource = "";

  try {
    while (true) {
      const draft = await generateSchemaDraft({
        prompt,
        model: options.model,
        verbose: options.verbose,
        feedback,
        previousSource: lastSource,
      });

      lastSource = normalizeSource(draft.source);

      try {
        await validateGeneratedSchema(lastSource);
      } catch (error) {
        throw new Error(
          [
            "Generated schema validation failed.",
            "Step: importing the generated Zod module and converting it to JSON Schema.",
            `Original error: ${formatError(error)}`,
            "Try regenerating, or run again and choose edit with a suggestion like: use only plain z.object, z.string, z.number, z.boolean, z.array, and z.enum fields.",
          ].join("\n"),
          { cause: error },
        );
      }

      output.write("\nGenerated schema:\n\n");
      output.write(`${lastSource}\n\n`);
      output.write(`Rationale: ${draft.rationale}\n\n`);

      const action = await askChoice(rl, "Approve and save? [a]pprove, [e]dit, [r]egenerate, [c]ancel: ");

      if (action === "a" || action === "approve") {
        await saveSchema(outPath, lastSource);
        output.write(`Saved schema to ${outPath}\n`);
        return;
      }

      if (action === "e" || action === "edit") {
        feedback = await askWithReadline(rl, "Enter suggestions to fix the schema: ");
        continue;
      }

      if (action === "r" || action === "regenerate") {
        feedback = "Regenerate a different schema for the same request. Keep the same output module contract.";
        continue;
      }

      if (action === "c" || action === "cancel") {
        output.write("Cancelled. No schema was saved.\n");
        return;
      }
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
  previousSource: string;
}): Promise<z.infer<typeof generatedSchemaResponse>> {
  const spinner = new Spinner("Generating schema with Codex");
  spinner.start();

  try {
    const result = await generateObject({
      model: createCodexModel(args.model, args.verbose),
      schema: generatedSchemaResponse,
      system: [
        "You generate Zod schemas for a web parser.",
        "Return a TypeScript module as a string.",
        "The module must import Zod with: import * as z from \"zod\";",
        "The module must export the schema as default.",
        "Use only Zod constructs that convert cleanly with z.toJSONSchema().",
        "Do not use transforms, refinements, z.date(), maps, sets, functions, custom validators, or side effects.",
        "Prefer z.object({...}) with descriptive .describe(...) calls on fields.",
        "Use required fields unless the user clearly asks for optional fields.",
      ].join("\n"),
      prompt: [
        `User extraction request:\n${args.prompt}`,
        args.previousSource ? `Previous schema draft:\n${args.previousSource}` : "",
        args.feedback ? `Revision instructions:\n${args.feedback}` : "",
        "Generate the complete schema module now.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    spinner.stop("Schema draft generated.");
    return result.object;
  } catch (error) {
    spinner.stop();
    throw new Error(
      [
        "Codex schema generation failed.",
        "Step: generating a Zod schema draft with Codex CLI.",
        `Model: ${args.model}.`,
        `Original error: ${formatError(error)}`,
        "Common fixes: run `bun install` so @openai/codex is installed from this project, verify Codex auth with `codex login` or OPENAI_API_KEY, then retry with --verbose for provider logs.",
      ].join("\n"),
      { cause: error },
    );
  }
}

async function validateGeneratedSchema(source: string): Promise<void> {
  const tempDir = resolve(".yo-url-yo-json/tmp");
  const tempPath = resolve(tempDir, `schema-${randomUUID()}.ts`);

  await mkdir(tempDir, { recursive: true });
  await writeFile(tempPath, source, "utf8");

  try {
    await loadSchema(tempPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function saveSchema(outPath: string, source: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${source.trimEnd()}\n`, "utf8");
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

async function askChoice(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  while (true) {
    const answer = (await askWithReadline(rl, question)).trim().toLowerCase();
    if (["a", "approve", "e", "edit", "r", "regenerate", "c", "cancel"].includes(answer)) {
      return answer;
    }
  }
}

async function askWithReadline(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return rl.question(question);
}

function normalizeSource(source: string): string {
  return stripCodeFence(source).trim();
}

function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  const match = trimmed.match(/^```(?:ts|typescript)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? trimmed;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
