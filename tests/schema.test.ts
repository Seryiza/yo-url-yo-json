import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadSchema, validateData } from "../src/schema";
import { SchemaValidationError } from "../src/types";

describe("schema loading", () => {
  test("loads JSON Schema files and validates with Zod", async () => {
    const bundle = await loadSchema(resolve("examples/product.schema.json"));

    expect(bundle.schema.type).toBe("object");

    const data = validateData(
      bundle,
      {
        title: "Widget",
        price: "$10",
        description: "A useful widget",
      },
      "test data",
    );

    expect(data).toEqual({
      title: "Widget",
      price: "$10",
      description: "A useful widget",
    });

    expect(() =>
      validateData(
        bundle,
        {
          title: "Widget",
          price: "$10",
          description: "A useful widget",
          ignored: true,
        },
        "test data",
      ),
    ).toThrow(SchemaValidationError);
  });

  test("rejects non-json schema paths", async () => {
    await expect(loadSchema(resolve("examples/product.schema.ts"))).rejects.toThrow(
      "Schema path must point to a .json JSON Schema file.",
    );
  });

  test("loads workflow-aware schemas without validating workflow metadata as output data", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "yoyj-schema-"));
    const schemaPath = resolve(tempDir, "workflow.schema.json");

    try {
      await writeFile(
        schemaPath,
        `${JSON.stringify(
          {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "detailUrl", "detailStatus", "detailOk"],
                  properties: {
                    title: { type: "string" },
                    detailUrl: { type: "string" },
                    detailStatus: { type: ["number", "null"] },
                    detailOk: { type: "boolean" },
                    detailError: { type: "string" },
                  },
                },
              },
            },
            "x-yoyj-workflow": {
              version: 1,
              missingDetailBehavior: "keepWithStatus",
              steps: [
                {
                  type: "extract",
                  name: "items",
                  schema: {
                    type: "object",
                    properties: {
                      items: { type: "array" },
                    },
                  },
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const bundle = await loadSchema(schemaPath);
      expect(bundle.workflow?.missingDetailBehavior).toBe("keepWithStatus");
      expect(bundle.outputSchema["x-yoyj-workflow"]).toBeUndefined();

      const data = validateData(
        bundle,
        {
          items: [
            {
              title: "Missing listing",
              detailUrl: "https://example.com/missing",
              detailStatus: 404,
              detailOk: false,
              detailError: "not_found",
            },
          ],
        },
        "workflow data",
      );

      expect(data).toEqual({
        items: [
          {
            title: "Missing listing",
            detailUrl: "https://example.com/missing",
            detailStatus: 404,
            detailOk: false,
            detailError: "not_found",
          },
        ],
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects invalid workflow metadata", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "yoyj-schema-"));
    const schemaPath = resolve(tempDir, "invalid-workflow.schema.json");

    try {
      await writeFile(
        schemaPath,
        `${JSON.stringify(
          {
            type: "object",
            properties: {
              items: { type: "array" },
            },
            "x-yoyj-workflow": {
              version: 1,
              steps: [{ type: "hover" }],
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await expect(loadSchema(schemaPath)).rejects.toThrow("Invalid x-yoyj-workflow");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
