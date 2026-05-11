export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonSchema = Record<string, unknown>;

export type SchemaBundle = {
  /**
   * Original schema file contents, including supported yo-url-yo-json metadata
   * extensions. Used for cache identity.
   */
  schema: JsonSchema;
  /**
   * Pure JSON Schema used for llm-scraper output generation and validation.
   */
  outputSchema: JsonSchema;
  workflow?: ExtractionWorkflow;
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

export type ScriptCacheKind = "root" | "workflow-detail";

export type ScriptMetadata = {
  origin: string;
  schemaHash: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  generator: "llm-scraper";
  model: string;
  attempts: number;
  kind?: ScriptCacheKind;
  routePattern?: string;
  codegenKey?: string;
  workflowStep?: string;
  sampleUrls?: string[];
  sampleStatuses?: Array<number | null>;
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
  truncateLongHtmlForLlm: boolean;
  headed: boolean;
  verbose: boolean;
};

export type MissingDetailBehavior =
  | "skip"
  | "keepWithStatus"
  | "errorBucket"
  | "keepWithStatusAndErrorBucket";

export type MergeStrategy = "merge" | "nest";

export type DetailCachePolicy = "route" | "none";

export type WorkflowWaitState = "attached" | "detached" | "visible" | "hidden";

export type WorkflowStep =
  | {
      type: "extract";
      name?: string;
      outputPath?: string;
      schema?: JsonSchema;
    }
  | {
      type: "click" | "hover" | "waitForSelector";
      selector: string;
      timeoutMs?: number;
      state?: WorkflowWaitState;
    }
  | {
      type: "scroll";
      selector?: string;
      x?: number;
      y?: number;
    }
  | {
      type: "goto";
      url?: string;
      urlPath?: string;
      captureStatusAs?: string;
      waitUntil?: "domcontentloaded" | "load" | "networkidle";
      timeoutMs?: number;
    }
  | {
      type: "forEach";
      itemsPath: string;
      steps: WorkflowStep[];
    }
  | {
      type: "detail";
      urlPath: string;
      schema?: JsonSchema;
      name?: string;
      outputPath?: string;
      mergeStrategy?: MergeStrategy;
      missingDetailBehavior?: MissingDetailBehavior;
      statusField?: string;
      okField?: string;
      errorField?: string;
      routePattern?: string;
      codegenKey?: string;
      sampleSize?: number;
      cachePolicy?: DetailCachePolicy;
      regenerateOnSchemaFailure?: boolean;
    };

export type ExtractionWorkflow = {
  version: 1;
  description?: string;
  startUrl?: string;
  steps: WorkflowStep[];
  missingDetailBehavior?: MissingDetailBehavior;
  mergeStrategy?: MergeStrategy;
  errorsPath?: string;
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
