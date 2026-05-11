import * as z from "zod";
import type { ExtractionWorkflow, JsonSchema, JsonValue, MissingDetailBehavior, WorkflowStep } from "./types";

export const WORKFLOW_EXTENSION_KEY = "x-yoyj-workflow";

const missingDetailBehaviorSchema = z.enum([
  "skip",
  "keepWithStatus",
  "errorBucket",
  "keepWithStatusAndErrorBucket",
] satisfies MissingDetailBehavior[]);
const mergeStrategySchema = z.enum(["merge", "nest"]);
const detailCachePolicySchema = z.enum(["route", "none"]);
const waitStateSchema = z.enum(["attached", "detached", "visible", "hidden"]);
const waitUntilSchema = z.enum(["domcontentloaded", "load", "networkidle"]);

const jsonSchemaSchema = z.record(z.string(), z.unknown()) as z.ZodType<JsonSchema>;

const workflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("extract"),
      name: z.string().min(1).optional(),
      outputPath: z.string().min(1).optional(),
      schema: jsonSchemaSchema.optional(),
    }),
    z.object({
      type: z.literal("click"),
      selector: z.string().min(1),
      timeoutMs: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal("hover"),
      selector: z.string().min(1),
      timeoutMs: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal("waitForSelector"),
      selector: z.string().min(1),
      timeoutMs: z.number().int().positive().optional(),
      state: waitStateSchema.optional(),
    }),
    z.object({
      type: z.literal("scroll"),
      selector: z.string().min(1).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
    z.object({
      type: z.literal("goto"),
      url: z.string().min(1).optional(),
      urlPath: z.string().min(1).optional(),
      captureStatusAs: z.string().min(1).optional(),
      waitUntil: waitUntilSchema.optional(),
      timeoutMs: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal("forEach"),
      itemsPath: z.string().min(1),
      steps: z.array(workflowStepSchema).min(1),
    }),
    z.object({
      type: z.literal("detail"),
      urlPath: z.string().min(1),
      schema: jsonSchemaSchema.optional(),
      name: z.string().min(1).optional(),
      outputPath: z.string().min(1).optional(),
      mergeStrategy: mergeStrategySchema.optional(),
      missingDetailBehavior: missingDetailBehaviorSchema.optional(),
      statusField: z.string().min(1).optional(),
      okField: z.string().min(1).optional(),
      errorField: z.string().min(1).optional(),
      routePattern: z.string().min(1).optional(),
      codegenKey: z.string().min(1).optional(),
      sampleSize: z.number().int().positive().optional(),
      cachePolicy: detailCachePolicySchema.optional(),
      regenerateOnSchemaFailure: z.boolean().optional(),
    }),
  ]),
);

const workflowSchema = z.object({
  version: z.literal(1),
  description: z.string().optional(),
  startUrl: z.string().min(1).optional(),
  steps: z.array(workflowStepSchema).min(1),
  missingDetailBehavior: missingDetailBehaviorSchema.optional(),
  mergeStrategy: mergeStrategySchema.optional(),
  errorsPath: z.string().min(1).optional(),
});

export function splitSchemaAndWorkflow(schema: JsonSchema): {
  outputSchema: JsonSchema;
  workflow?: ExtractionWorkflow;
} {
  const outputSchema = { ...schema };
  const rawWorkflow = outputSchema[WORKFLOW_EXTENSION_KEY];
  delete outputSchema[WORKFLOW_EXTENSION_KEY];

  if (rawWorkflow === undefined) {
    return { outputSchema };
  }

  const result = workflowSchema.safeParse(rawWorkflow);
  if (!result.success) {
    throw new Error(`Invalid ${WORKFLOW_EXTENSION_KEY}: ${formatZodError(result.error)}`);
  }

  return {
    outputSchema,
    workflow: result.data,
  };
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }

  const type = typeof value;
  if (type === "string" || type === "boolean") {
    return true;
  }

  if (type === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (type === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }

  return false;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? `/${issue.path.join("/")}` : "/";
      return `${path} ${issue.message}`;
    })
    .join("; ");
}
