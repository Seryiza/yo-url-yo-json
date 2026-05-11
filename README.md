<p align="right">
  <img width="300" height="300" alt="yoyo-logo" src="https://github.com/user-attachments/assets/adf5a2d5-8649-4228-91d8-fbe7926f8295" />
</p>

# 🪀✨ yo url yo json

*URL + Schema -> JSON*

`yo-url-yo-json` is a Bun + TypeScript CLI for extracting validated JSON from a webpage using [llm-scraper](https://github.com/mishushakov/llm-scraper), [CloakBrowser](https://github.com/CloakHQ/CloakBrowser), and [ai-sdk-provider-codex-cli](https://github.com/ben-vargas/ai-sdk-provider-codex-cli).

## how to use it
1. say what you want to parse via cli or agent skill.
2. get a generated json schema.
3. use url + schema to generate reusable parser code.
4. run it as many times as you want.

## usage examples
- [bun + typescript watcher for house.kg search result pages](https://github.com/Seryiza/housekg-telegram-notifications)

## dependencies
- bun
- codex: `codex login` or `OPENAI_API_KEY`
- optional: running CDP service; CloakBrowser as fallback (npm)

## usage
### agent skill

Project-local skill: `skills/yo-url-yo-json/SKILL.md`.

### cli

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

### package.json

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

Stdout is parsed JSON. Diagnostics go to stderr.

## runtime flow

1. Browser: `YOYJ_CDP_ENDPOINT` CDP service, else local npm `cloakbrowser`.
2. Extractor: cached script, else llm-scraper + Codex CLI generation.
3. Output: JSON Schema validation, then stdout.

Generated extractors: `.yo-url-yo-json/scripts/`.

`YOYJ_CDP_ENDPOINT` supports `http`, `https`, `ws`, and `wss`.

## nix development shell

```bash
nix develop
bun install
bun test
```

Direnv:

```bash
direnv allow
```

## schemas

The project uses [JSON Schema](https://json-schema.org/). Schema paths must end in `.json`.

## development

```bash
bun run typecheck
bun test

# publish
bun run build
npm pack --dry-run
npm publish
```
