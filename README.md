<p align="right">
  <img width="300" height="300" alt="yoyo-logo" src="https://github.com/user-attachments/assets/adf5a2d5-8649-4228-91d8-fbe7926f8295" />
</p>

# 🪀✨ yo url yo json

*URL + Schema -> JSON*

`yo-url-yo-json` is a Bun + TypeScript CLI for extracting validated JSON from a webpage using [llm-scraper](https://github.com/mishushakov/llm-scraper), [CloakBrowser](https://github.com/CloakHQ/CloakBrowser), and [ai-sdk-provider-codex-cli](https://github.com/ben-vargas/ai-sdk-provider-codex-cli).

## Install

- Bun
- Docker
- Codex auth: `codex login` or `OPENAI_API_KEY`
- Project deps: `bun install`

From another TypeScript project:

```bash
bun add -d yo-url-yo-json
```

```json
{
  "scripts": {
    "extract": "yo-url-yo-json parse --url https://example.com --schema ./schemas/product.schema.json",
    "schema": "yo-url-yo-json generate-schema --out ./schemas/product.schema.json"
  }
}
```

## Agent Skill

Project-local skill: `skills/yo-url-yo-json/SKILL.md`.

## Usage

Generate a JSON Schema with Codex:

```bash
yo-url-yo-json generate-schema --out ./schemas/product.schema.json
```

Parse a page with Codex-powered extraction:

```bash
yo-url-yo-json parse --url "https://example.com" --schema ./schemas/product.schema.json
```

`parse` and `generate-schema` are subcommands of the single `yo-url-yo-json` executable; they are not separate npm bin aliases.

Useful options for `yo-url-yo-json parse`:

```bash
--cache-dir .yo-url-yo-json/scripts
--model gpt-5.5
--force-regenerate
--headed
--verbose
```

Stdout is parsed JSON. Diagnostics go to stderr.

## Runtime Flow

```mermaid
flowchart TD
  A["URL + JSON Schema"] --> B["Start CloakBrowser via Docker"]
  B --> C{"Cached extractor valid?"}
  C -- "yes" --> D["Run cached Playwright extractor"]
  C -- "no" --> E["Generate extractor with llm-scraper + Codex CLI"]
  D --> F["Validate JSON Schema"]
  E --> F
  F --> G["Print JSON"]
```

Generated extractors are saved under `.yo-url-yo-json/scripts/`.

## Schemas

The project uses [JSON Schema](https://json-schema.org/). Schema paths must end in `.json`.

## CloakBrowser Docker Runtime

We use CloakBrowser via Docker.

Useful commands:

```bash
bun run docker:pull
bun run docker:cleanup
yo-url-yo-json parse --url "https://example.com" --schema ./examples/product.schema.json
```

## Development

```bash
bun run typecheck
bun test

# publish
bun run build
npm pack --dry-run
npm publish
```
