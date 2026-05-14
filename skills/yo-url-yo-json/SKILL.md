---
name: yo-url-yo-json
description: Parse a webpage URL into JSON matching a user-provided JSON Schema by running this project's Bun CLI with Camoufox, llm-scraper, and Codex CLI. Use when the user asks to extract structured data from a webpage with schema-constrained output.
---

# yo-url-yo-json

Use this skill to return structured JSON for a URL and a JSON Schema.

## Workflow

1. Ensure the user provided a URL and JSON Schema. If the user wants help creating the schema, use `bun commands/generate-schema.ts`.
2. Run the CLI:
   ```bash
   bun commands/parse.ts --url "https://example.com" --schema ./schema.json
   ```
3. Return the CLI stdout JSON as the answer. Keep stderr diagnostics only for troubleshooting.

## Schema Generation

When the user describes what they want extracted but has no schema yet:

```bash
bun commands/generate-schema.ts --out ./schema.json
```

The command asks for the extraction prompt interactively, shows a generated draft 2020-12 JSON
Schema, then saves when the user presses Enter or regenerates when the user enters suggestions.

## Behavior

- The CLI uses Camoufox for page access.
- It reuses generated Playwright extractors when possible.
- Codex and `llm-scraper` generate or repair extractors when needed.
- Generated extractors are stored under `.yo-url-yo-json/scripts/`.
- Generated schemas are saved only after approval.

## Notes

- JSON Schema is the public schema format. The CLI validates JSON Schema with Zod's
  `z.fromJSONSchema()` internally.
- Schema paths must end in `.json`.
- Codex auth must be available via `codex login` or `OPENAI_API_KEY`; run the TypeScript entry files from the project root so the project-pinned `@openai/codex` CLI is used.
