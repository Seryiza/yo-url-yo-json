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
  };
}

function codePath(cacheDir: string, key: CacheKey): string {
  return join(cacheDir, `${key.slug}.js`);
}

function metadataPath(cacheDir: string, key: CacheKey): string {
  return join(cacheDir, `${key.slug}.metadata.json`);
}
