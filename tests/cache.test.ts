import { describe, expect, test } from "bun:test";
import { buildCacheKey } from "../src/cache";
import { hashJson } from "../src/json";

describe("cache keys", () => {
  test("normalizes URL origins and hashes stable schema content", () => {
    const schemaA = {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
      },
    };
    const schemaB = {
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
      type: "object",
    };

    const keyA = buildCacheKey("HTTPS://Example.COM/products/1?ref=a", schemaA);
    const keyB = buildCacheKey("https://example.com/products/2", schemaB);

    expect(keyA.origin).toBe("https://example.com");
    expect(keyA.schemaHash).toBe(keyB.schemaHash);
    expect(keyA.slug).toBe(keyB.slug);
  });
});

describe("stable JSON hashing", () => {
  test("ignores object key order", () => {
    expect(hashJson({ b: 1, a: { d: 2, c: 3 } })).toBe(hashJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
