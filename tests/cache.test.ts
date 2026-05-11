import { describe, expect, test } from "bun:test";
import { buildCacheKey, buildWorkflowDetailCacheKey, inferRoutePattern } from "../src/cache";
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

  test("infers shared dynamic route patterns for detail URLs", () => {
    expect(inferRoutePattern("https://www.house.kg/details/257606869f8ac143388d8-96865122")).toBe(
      "https://www.house.kg/details/:id",
    );
    expect(inferRoutePattern("https://www.house.kg/details/293675569b127ab087bb8-39392852")).toBe(
      "https://www.house.kg/details/:id",
    );
    expect(inferRoutePattern("https://www.house.kg/search/results")).toBe("https://www.house.kg/search/results");
  });

  test("builds workflow detail cache keys by route, schema, and model", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
      },
    };
    const keyA = buildWorkflowDetailCacheKey({
      url: "https://www.house.kg/details/257606869f8ac143388d8-96865122",
      schema,
      model: "gpt-5.5",
      routePattern: "https://www.house.kg/details/:id",
    });
    const keyB = buildWorkflowDetailCacheKey({
      url: "https://www.house.kg/details/293675569b127ab087bb8-39392852",
      schema,
      model: "gpt-5.5",
      routePattern: "https://www.house.kg/details/:id",
    });
    const keyC = buildWorkflowDetailCacheKey({
      url: "https://www.house.kg/details/293675569b127ab087bb8-39392852",
      schema,
      model: "gpt-5.4",
      routePattern: "https://www.house.kg/details/:id",
    });
    const keyD = buildWorkflowDetailCacheKey({
      url: "https://www.house.kg/listing/293675569b127ab087bb8-39392852",
      schema,
      model: "gpt-5.5",
      routePattern: "https://www.house.kg/listing/:id",
      codegenKey: "house-detail-layout",
    });
    const keyE = buildWorkflowDetailCacheKey({
      url: "https://www.house.kg/details/257606869f8ac143388d8-96865122",
      schema,
      model: "gpt-5.5",
      routePattern: "https://www.house.kg/details/:id",
      codegenKey: "house-detail-layout",
    });

    expect(keyA.slug).toBe(keyB.slug);
    expect(keyA.schemaHash).not.toBe(keyC.schemaHash);
    expect(keyD.slug).toBe(keyE.slug);
  });
});

describe("stable JSON hashing", () => {
  test("ignores object key order", () => {
    expect(hashJson({ b: 1, a: { d: 2, c: 3 } })).toBe(hashJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
