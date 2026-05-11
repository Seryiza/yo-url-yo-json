import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CachedScript, CacheKey, JsonSchema, ScriptMetadata } from "./types";
import { hashJson } from "./json";

export function buildCacheKey(url: string, schema: JsonSchema): CacheKey {
  const parsed = new URL(url);
  const origin = parsed.origin.toLowerCase();
  const schemaHash = hashJson(schema);
  const hostSlug = parsed.hostname.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return {
    origin,
    schemaHash,
    slug: `${hostSlug || "site"}-${schemaHash.slice(0, 16)}`,
  };
}

export function buildWorkflowDetailCacheKey(args: {
  url: string;
  schema: JsonSchema;
  model: string;
  routePattern: string;
  codegenKey?: string;
}): CacheKey {
  const parsed = new URL(args.url);
  const origin = parsed.origin.toLowerCase();
  const cachePattern = args.codegenKey ? `codegen:${args.codegenKey}` : args.routePattern;
  const schemaHash = hashJson({
    kind: "workflow-detail-v1",
    schema: args.schema,
    model: args.model,
    routePattern: cachePattern,
    codegenKey: args.codegenKey,
  });
  const hostSlug = slugify(parsed.hostname.toLowerCase()) || "site";
  const routeSlug = slugify(cachePattern).slice(0, 48) || "detail";

  return {
    origin,
    schemaHash,
    slug: `${hostSlug}-workflow-detail-${routeSlug}-${schemaHash.slice(0, 16)}`,
  };
}

export function inferRoutePattern(url: string): string {
  const parsed = new URL(url);
  const pathname = parsed.pathname
    .split("/")
    .map((segment) => (isDynamicPathSegment(segment) ? ":id" : segment))
    .join("/");

  return `${parsed.origin.toLowerCase()}${pathname || "/"}`;
}

export async function readCachedScript(cacheDir: string, key: CacheKey): Promise<CachedScript | null> {
  try {
    const [code, metadataText] = await Promise.all([
      readFile(codePath(cacheDir, key), "utf8"),
      readFile(metadataPath(cacheDir, key), "utf8"),
    ]);

    return {
      code,
      metadata: JSON.parse(metadataText) as ScriptMetadata,
    };
  } catch {
    return null;
  }
}

export async function writeCachedScript(
  cacheDir: string,
  key: CacheKey,
  code: string,
  metadata: ScriptMetadata,
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  await Promise.all([
    writeFile(codePath(cacheDir, key), code, "utf8"),
    writeFile(`${codePath(cacheDir, key)}.latest`, code, "utf8"),
    writeFile(metadataPath(cacheDir, key), `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
  ]);
}

export function createMetadata(args: {
  key: CacheKey;
  url: string;
  model: string;
  previous?: ScriptMetadata;
  kind?: ScriptMetadata["kind"];
  routePattern?: string;
  codegenKey?: string;
  workflowStep?: string;
  sampleUrls?: string[];
  sampleStatuses?: Array<number | null>;
}): ScriptMetadata {
  const now = new Date().toISOString();

  return {
    origin: args.key.origin,
    schemaHash: args.key.schemaHash,
    sourceUrl: args.url,
    createdAt: args.previous?.createdAt ?? now,
    updatedAt: now,
    generator: "llm-scraper",
    model: args.model,
    attempts: (args.previous?.attempts ?? 0) + 1,
    kind: args.kind,
    routePattern: args.routePattern,
    codegenKey: args.codegenKey,
    workflowStep: args.workflowStep,
    sampleUrls: args.sampleUrls,
    sampleStatuses: args.sampleStatuses,
  };
}

function codePath(cacheDir: string, key: CacheKey): string {
  return join(cacheDir, `${key.slug}.js`);
}

function metadataPath(cacheDir: string, key: CacheKey): string {
  return join(cacheDir, `${key.slug}.metadata.json`);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isDynamicPathSegment(segment: string): boolean {
  if (!segment) {
    return false;
  }

  if (/^\d+$/.test(segment)) {
    return true;
  }

  if (segment.length >= 8 && /^[a-f0-9-]+$/i.test(segment) && /\d/.test(segment)) {
    return true;
  }

  return segment.length >= 12 && /\d/.test(segment);
}
