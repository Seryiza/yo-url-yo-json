import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadSchema, validateData } from "../src/schema";

describe("schema loading", () => {
  test("loads Zod schema modules and validates with Zod", async () => {
    const bundle = await loadSchema(resolve("examples/product.schema.ts"));

    expect(bundle.source).toBe("zod");
    expect(bundle.schema.type).toBe("object");

    const data = validateData(
      bundle,
      {
        title: "Widget",
        price: "$10",
        description: "A useful widget",
        ignored: true,
      },
      "test data",
    );

    expect(data).toEqual({
      title: "Widget",
      price: "$10",
      description: "A useful widget",
    });
  });
});
