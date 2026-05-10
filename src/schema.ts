import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import * as z from "zod";
import type { JsonSchema, SchemaBundle } from "./types";
import { SchemaValidationError } from "./types";

export async function loadSchema(schemaPath: string): Promise<SchemaBundle> {
  if (isZodModulePath(schemaPath)) {
    return loadZodSchema(schemaPath);
  }

  return loadJsonSchema(schemaPath);
}

function loadJsonSchema(schemaPath: string): Promise<SchemaBundle> {
  return readJsonSchema(schemaPath).then(createJsonSchemaBundle);
}

async function readJsonSchema(schemaPath: string): Promise<JsonSchema> {
  let schema: unknown;

  try {
    schema = JSON.parse(await readFile(schemaPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON Schema at ${schemaPath}: ${formatError(error)}`);
  }

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("Schema file must contain a JSON object.");
  }

  return schema as JsonSchema;
}

async function loadZodSchema(schemaPath: string): Promise<SchemaBundle> {
  let mod: Record<string, unknown>;

  try {
    mod = (await import(pathToFileURL(schemaPath).href)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to import Zod schema module at ${schemaPath}: ${formatError(error)}`);
  }

  const zodSchema = mod.default ?? mod.schema;
  if (!isZodSchema(zodSchema)) {
    throw new Error("Zod schema module must export a Zod schema as default or named export `schema`.");
  }

  let jsonSchema: unknown;

  try {
    jsonSchema = z.toJSONSchema(zodSchema, {
      target: "draft-2020-12",
      unrepresentable: "throw",
      cycles: "ref",
      reused: "ref",
    });
  } catch (error) {
    throw new Error(`Failed to convert Zod schema to JSON Schema: ${formatError(error)}`);
  }

  const jsonBundle = createJsonSchemaBundle(jsonSchema as JsonSchema);

  return {
    schema: jsonBundle.schema,
    source: "zod",
    validate(data: unknown) {
      const result = zodSchema.safeParse(data);
      if (!result.success) {
        throw new SchemaValidationError("Data did not match the Zod schema.", result.error);
      }
      return result.data;
    },
  };
}

function createJsonSchemaBundle(schema: JsonSchema): SchemaBundle {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: true,
  });
  addFormats(ajv);

  const validSchema = ajv.validateSchema(schema);
  if (!validSchema) {
    throw new SchemaValidationError("Input JSON Schema is invalid.", ajv.errors);
  }

  const validator = ajv.compile(schema);

  return {
    schema,
    source: "json-schema",
    validate(data: unknown) {
      if (!validator(data)) {
        throw new SchemaValidationError("Data did not match the JSON Schema.", validator.errors);
      }
      return data;
    },
  };
}

export function validateData(bundle: SchemaBundle, data: unknown, label: string): unknown {
  try {
    return bundle.validate(data);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw new SchemaValidationError(`${label} did not match the ${schemaSourceLabel(bundle)}.`, error.errors);
    }
    throw error;
  }
}

export function formatValidationErrors(errors: unknown): string {
  if (errors instanceof z.ZodError) {
    return errors.issues
      .map((issue) => {
        const path = issue.path.length ? `/${issue.path.join("/")}` : "/";
        return `${path} ${issue.message}`;
      })
      .join("; ");
  }

  if (!Array.isArray(errors) || !errors.length) {
    return "unknown schema validation error";
  }

  return errors
    .map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message ?? error.keyword}`;
    })
    .join("; ");
}

function isZodModulePath(schemaPath: string): boolean {
  return /\.(mjs|cjs|js|mts|cts|ts)$/.test(schemaPath);
}

function isZodSchema(value: unknown): value is z.ZodType {
  return Boolean(
    value &&
      typeof value === "object" &&
      "safeParse" in value &&
      typeof (value as { safeParse?: unknown }).safeParse === "function",
  );
}

function schemaSourceLabel(bundle: SchemaBundle): string {
  return bundle.source === "zod" ? "Zod schema" : "JSON Schema";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
