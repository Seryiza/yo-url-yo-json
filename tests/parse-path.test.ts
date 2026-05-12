import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { resolveCliPath } from "../commands/parse";

describe("parse CLI path resolution", () => {
  test("resolves relative paths from the current working directory", () => {
    expect(resolveCliPath("schemas/housekg-listings.schema.json", "/work/housekg")).toBe(
      resolve("/work/housekg", "schemas/housekg-listings.schema.json"),
    );
  });

  test("keeps absolute paths unchanged", () => {
    expect(resolveCliPath("/nix/store/package/schema.json", "/work/housekg")).toBe(
      "/nix/store/package/schema.json",
    );
  });
});
