---
name: yo-url-yo-json
description: Parse a webpage URL into JSON matching a user-provided JSON Schema by running this project's Bun CLI with CloakBrowser, llm-scraper, and Codex CLI. Use when the user asks to extract structured data from a webpage with schema-constrained output.
---

# yo-url-yo-json

Use this skill to return structured JSON for a URL and a JSON Schema.

## Workflow

1. Ensure the user provided a URL and JSON Schema. If the user wants help creating the schema, use `bun commands/generate-schema.ts`.
2. Pull the official CloakBrowser image if needed:
   ```bash
   bun run docker:pull
   ```
3. Run the CLI:
   ```bash
   bun commands/parse.ts --url "https://example.com" --schema ./schema.json
   ```
4. Return the CLI stdout JSON as the answer. Keep stderr diagnostics only for troubleshooting.

## Schema Generation

When the user describes what they want extracted but has no schema yet:

```bash
bun commands/generate-schema.ts --out ./schema.json
```

The command asks for the extraction prompt interactively, shows a generated draft 2020-12 JSON
Schema, then saves when the user presses Enter or regenerates when the user enters suggestions.

## Behavior

- The CLI runs on the host and launches a fresh official CloakBrowser Docker container for each parse run.
- `bun commands/parse.ts` starts from Bun but re-executes under Node via `tsx` because Playwright's CDP transport hangs under Bun with CloakBrowser's CDP proxy.
- Codex and Bun run on the host, not in Docker.
- It reuses a generated Playwright extractor when one exists for the URL origin and schema hash.
- If the cached extractor throws, times out, or returns schema-invalid data, the CLI regenerates it with `llm-scraper`.
- Generated extractors are stored under `.yo-url-yo-json/scripts/`.
- Generated schemas are saved only after approval.

## Notes

- JSON Schema is the public schema format. The CLI validates JSON Schema with Zod's
  `z.fromJSONSchema()` internally.
- Schema paths must end in `.json`.
- Docker is used only for CloakBrowser via `cloakhq/cloakbrowser:latest` and CDP.
- CloakBrowser's binary cache is persisted in Docker volume `yo-url-yo-json-cloakbrowser-cache`, and background updates are disabled by default. Set `YOYJ_CLOAKBROWSER_AUTO_UPDATE=true` for an explicit update run, or `YOYJ_CLOAKBROWSER_CACHE_VOLUME=none` for a fully disposable cache.
- Codex auth must be available via `codex login` or `OPENAI_API_KEY`; run the TypeScript entry files from the project root so the project-pinned `@openai/codex` CLI is used.
