export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonSchema = Record<string, unknown>;

export type SchemaBundle = {
  schema: JsonSchema;
  source: "json-schema" | "zod";
  validate(data: unknown): unknown;
};

export type CacheKey = {
  origin: string;
  schemaHash: string;
  slug: string;
};

export type CachedScript = {
  code: string;
  metadata: ScriptMetadata;
};

export type ScriptMetadata = {
  origin: string;
  schemaHash: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  generator: "llm-scraper";
  model: string;
  attempts: number;
};

export type ParseOptions = {
  url: string;
  schemaPath: string;
  cacheDir: string;
  progressSteps: number;
  model: string;
  timeoutMs: number;
  gotoTimeoutMs: number;
  forceRegenerate: boolean;
  headed: boolean;
  verbose: boolean;
};

export type ExtractFailureReason =
  | "cache-miss"
  | "cached-script-threw"
  | "cached-script-timed-out"
  | "cached-script-schema-invalid";

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    readonly errors: unknown,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}
