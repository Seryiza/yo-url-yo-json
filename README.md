<p align="right">
  <img width="300" height="300" alt="yoyo-logo" src="https://github.com/user-attachments/assets/adf5a2d5-8649-4228-91d8-fbe7926f8295" />
</p>

# yo url yo json

WIP

URL + JSON Schema -> JSON

`yo-url-yo-json` is a Bun + TypeScript CLI for extracting structured JSON from a webpage.
It accepts a JSON Schema file, launches CloakBrowser through its Playwright-compatible API,
reuses generated Playwright extractors when possible, and
regenerates them with `llm-scraper` + Codex CLI when needed.

## Runtime Flow

1. Read a URL and JSON Schema file.
2. For parsing, start a fresh official CloakBrowser Docker container in CDP server mode.
3. Look for a generated extractor by normalized URL origin + schema hash.
4. Run the cached extractor when present.
5. If the cached extractor is missing, throws, times out, or returns schema-invalid data, generate a new extractor with `llm-scraper`.
6. Validate the final result against the schema.
7. Print JSON to stdout and close browser resources.

Generated extractors are saved under `.yo-url-yo-json/scripts/`.

## Install

```bash
bun install
```

Node.js must also be available on `PATH`. The public commands are still launched with Bun, but
`parse` re-executes the TypeScript CLI under Node via `tsx` because Playwright's CDP transport
hangs under Bun when connecting to CloakBrowser's CDP proxy.

Codex auth must be available:

```bash
codex login
# or export OPENAI_API_KEY=...
```

The project pins `@openai/codex@0.130.0` directly because
`ai-sdk-provider-codex-cli@1.1.0` declares an older optional `@openai/codex` dependency that
does not support `gpt-5.5`. Run the TypeScript entry files from the project root so the provider
resolves the project-installed Codex CLI from `node_modules`.

## Usage

Generate a JSON Schema with Codex and approve it interactively:

```bash
bun commands/generate-schema.ts --out ./schemas/product.schema.json
```

The command asks what data to extract, then shows a schema draft for approval.

Then parse a page with the saved schema:

```bash
bun commands/parse.ts --url "https://example.com" --schema ./schemas/product.schema.json
```

`bun commands/generate-schema.ts` runs on the host and uses the project-installed Codex CLI/auth.
`bun commands/parse.ts` starts from Bun, re-executes the parser under Node for Playwright
compatibility, and starts an official CloakBrowser Docker container for the browser only.

Useful options:

```bash
--cache-dir .yo-url-yo-json/scripts
--model gpt-5.5
--force-regenerate
--headed
--verbose
```

Stdout is reserved for parsed JSON. Diagnostics are written to stderr.

## Schema Generation

The schema generator asks for a prompt, drafts a draft 2020-12 JSON Schema, validates that it
can be converted with `z.fromJSONSchema()`, then shows the draft for review.

```bash
bun commands/generate-schema.ts --out ./schemas/article.schema.json
```

After each draft:

```text
Press Enter to save, or enter suggestions to regenerate.
```

## Schemas

JSON Schema is the public schema format. The parser converts JSON Schema files to Zod
schemas with `z.fromJSONSchema()` for validation:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "price", "description"],
  "properties": {
    "title": {
      "type": "string",
      "description": "Main page title"
    },
    "price": {
      "type": "string",
      "description": "Displayed price including currency"
    },
    "description": {
      "type": "string"
    }
  }
}
```

Schema paths must end in `.json`.

```bash
bun commands/parse.ts --url "https://example.com" --schema ./examples/product.schema.json
```

## CloakBrowser Docker Runtime

Docker is used only for CloakBrowser. Bun, TypeScript, `llm-scraper`, and Codex CLI run on the
host. The parser starts `cloakhq/cloakbrowser:latest` with `cloakserve`, connects over CDP from
host Playwright, then stops the container when parsing finishes.

CloakBrowser stores its Chromium binary cache in a persistent Docker volume named
`yo-url-yo-json-cloakbrowser-cache`. This avoids downloading the ~200 MB Chromium update on
every parse run. Background update checks are disabled by default with
`CLOAKBROWSER_AUTO_UPDATE=false`; update the Docker image with `bun run docker:pull` when you
want a newer bundled browser.

Pre-pull the official image if desired:

```bash
bun run docker:pull
```

Clean up interrupted parser containers:

```bash
bun run docker:cleanup
```

Run normally:

```bash
bun commands/parse.ts --url "https://example.com" --schema ./examples/product.schema.json
```

If the CloakBrowser image is not present locally, Docker will pull it automatically on first use.
Override the image with `YOYJ_CLOAKBROWSER_IMAGE=cloakhq/cloakbrowser:<tag>`.

Useful CloakBrowser runtime overrides:

```bash
# Re-enable CloakBrowser background updates. Downloads are persisted in the Docker volume.
YOYJ_CLOAKBROWSER_AUTO_UPDATE=true bun commands/parse.ts --url "https://example.com" --schema ./examples/product.schema.json

# Use another cache volume, or set to "none" for a fully disposable browser cache.
YOYJ_CLOAKBROWSER_CACHE_VOLUME=my-cloak-cache bun commands/parse.ts --url "https://example.com" --schema ./examples/product.schema.json
YOYJ_CLOAKBROWSER_CACHE_VOLUME=none bun commands/parse.ts --url "https://example.com" --schema ./examples/product.schema.json
```

If Codex exits with an error, rerun with `--verbose`, check auth with `codex login` or
`OPENAI_API_KEY`, and confirm `node_modules/.bin/codex --version` reports the pinned version.

## Agent Skill

A project-local skill is available at `skills/yo-url-yo-json/SKILL.md`.

## Development

```bash
bun run typecheck
bun test
```
