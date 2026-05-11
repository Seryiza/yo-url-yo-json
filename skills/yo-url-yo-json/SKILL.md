---
name: yo-url-yo-json
description: Parse a webpage URL into JSON matching a user-provided Zod schema or JSON Schema by running this project's Bun CLI with CloakBrowser, llm-scraper, and Codex CLI. Use when the user asks to extract structured data from a webpage with schema-constrained output.
---

# yo-url-yo-json

Use this skill to return structured JSON for a URL and a Zod schema or JSON Schema.

## Workflow

1. Ensure the user provided a URL and schema. If the user wants help creating the schema, use `bun commands/generate-schema.ts`.
2. Pull the official CloakBrowser image if needed:
   ```bash
   bun run docker:pull
   ```
3. Run the CLI:
   ```bash
   bun commands/parse.ts --url "https://example.com" --schema ./schema.ts
   ```
4. Return the CLI stdout JSON as the answer. Keep stderr diagnostics only for troubleshooting.

## Schema Generation

When the user describes what they want extracted but has no schema yet:

```bash
bun commands/generate-schema.ts --out ./schema.ts
```

The command asks for the extraction prompt interactively, shows a generated Zod schema, and lets
the user approve, edit with suggestions, regenerate, or cancel. Pass `--url` only when a known
page URL would help shape the schema; it is not required. Use `--yes` only when the user
explicitly asks for non-interactive mode.

## Behavior

- The CLI runs on the host and launches a fresh official CloakBrowser Docker container for each parse run.
- `bun commands/parse.ts` starts from Bun but re-executes under Node via `tsx` because Playwright's CDP transport hangs under Bun with CloakBrowser's CDP proxy.
- Codex and Bun run on the host, not in Docker.
- It reuses a generated Playwright extractor when one exists for the URL origin and schema hash.
- If the cached extractor throws, times out, or returns schema-invalid data, the CLI regenerates it with `llm-scraper`.
- Generated extractors are stored under `.yo-url-yo-json/scripts/`.
- Generated schemas are saved only after approval unless `--yes` is set.

## Notes

- Zod is the preferred authoring format. Export a Zod schema as `default` or named `schema`.
- The CLI converts Zod to JSON Schema for extractor generation and validates final JSON with Zod.
- Docker is used only for CloakBrowser via `cloakhq/cloakbrowser:latest` and CDP.
- CloakBrowser's binary cache is persisted in Docker volume `yo-url-yo-json-cloakbrowser-cache`, and background updates are disabled by default. Set `YOYJ_CLOAKBROWSER_AUTO_UPDATE=true` for an explicit update run, or `YOYJ_CLOAKBROWSER_CACHE_VOLUME=none` for a fully disposable cache.
- Codex auth must be available via `codex login` or `OPENAI_API_KEY`; run the TypeScript entry files from the project root so the project-pinned `@openai/codex` CLI is used.
