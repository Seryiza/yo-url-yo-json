import { readFile } from "node:fs/promises";
import * as z from "zod";
import type { JsonSchema, SchemaBundle } from "./types";
import { SchemaValidationError } from "./types";

export async function loadSchema(schemaPath: string): Promise<SchemaBundle> {
  assertJsonSchemaPath(schemaPath);
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

function createJsonSchemaBundle(schema: JsonSchema): SchemaBundle {
  let zodSchema: z.ZodType;

  try {
    zodSchema = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  } catch (error) {
    throw new Error(`Failed to convert JSON Schema to Zod schema: ${formatError(error)}`);
  }

  return {
    schema,
    validate(data: unknown) {
      const result = zodSchema.safeParse(data);
      if (!result.success) {
        throw new SchemaValidationError("Data did not match the JSON Schema.", result.error);
      }
      return result.data;
    },
  };
}

export function validateData(bundle: SchemaBundle, data: unknown, label: string): unknown {
  try {
    return bundle.validate(data);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw new SchemaValidationError(`${label} did not match the JSON Schema.`, error.errors);
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertJsonSchemaPath(schemaPath: string): void {
  if (!schemaPath.endsWith(".json")) {
    throw new Error(`Schema path must point to a .json JSON Schema file. Received: ${schemaPath}`);
  }
}
