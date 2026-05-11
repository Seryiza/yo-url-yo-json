import { describe, expect, test } from "bun:test";
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
});
