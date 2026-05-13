<p align="right">
  <img width="300" height="300" alt="yoyo-logo" src="https://github.com/user-attachments/assets/adf5a2d5-8649-4228-91d8-fbe7926f8295" />
</p>

# 🪀 yo url yo json
- 🪀 is a TypeScript Bun CLI for extracting validated JSON from webpages
- 💡 is built around the idea *"your URL + your Schema => parsed JSON"*
- 🖼️ uses LLMs to generate schemas and playwright scripts, after that **doesn't use** LLMs
- 👐 relies on open source projects: [llm-scraper](https://github.com/mishushakov/llm-scraper), [CloakBrowser](https://github.com/CloakHQ/CloakBrowser), [ai-sdk-provider-codex-cli](https://github.com/ben-vargas/ai-sdk-provider-codex-cli).

## Bun CLI usage

1. 👉 say what you want to parse via interactive cli

<details>
    <summary><code>bun run commands/generate-schema.ts --out my-schema.json</code></summary>

```
Describe the data you want to extract: youtube gaming feed with video: title, youtube video link, channel name
Generating schema with Codex...
Schema draft generated.

Generated schema:

{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "description": "YouTube Gaming feed extraction containing visible video entries and their core listing metadata.",
  "properties": {
    "videos": {
      "type": "array",
      "description": "Video entries shown in the YouTube Gaming feed.",
      "items": {
        "type": "object",
        "description": "A single video entry from the feed.",
        "properties": {
          "title": {
            "type": "string",
            "description": "The visible title of the YouTube video."
          },
          "youtubeVideoLink": {
            "type": "string",
            "description": "The absolute YouTube watch URL or Shorts URL for the video."
          },
          "channelName": {
            "type": "string",
            "description": "The visible name of the channel that published the video."
          }
        },
        "required": [
          "title",
          "youtubeVideoLink",
          "channelName"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "videos"
  ],
  "additionalProperties": false
}

Rationale: The request asks for feed-level extraction only, so the schema models a root object with a required videos array and required listing fields for each video. No workflow metadata is included because no clicks, detail-page visits, scrolling, waiting, or enrichment steps were requested.

Press Enter to save, or enter suggestions to regenerate:
Saved schema to my-schema.json
```

</details>

2. 👉 use url + schema to generate reusable parser code.

<details>
    <summary><code>bun run commands/parse.ts --schema my-schema.json --url "https://www.youtube.com/gaming"</code></summary>

```
{
  "videos": [
    {
      "title": "🔴 HELIOPOLIS IN 2 RUNS 🔴 40%, 37-100 🔴 STREAM 11",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=7G2YtcCsomI",
      "channelName": "Zoink"
    },
    {
      "title": "Hello Neighbor 3: EXPLOSION inesperada!",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=sGXGy37AKcE",
      "channelName": "VEGETTA777"
    },
    {
      "title": "Pokémon Super S Ep.37 - LA CAGADA DEL LOCKE. NOOOO.",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=VCs2gCZknvA",
      "channelName": "Folagor03"
    },
    {
      "title": "Sins of Alchemax | Marvel Rivals Season 8 Trailer | Marvel Rivals",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=F4B0Jpr4Rw4",
      "channelName": "Marvel Rivals"
    },
    {
      "title": "Our Airport Security Still Sucks...",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=8NCaEveCxJ8",
      "channelName": "SMii7Y"
    },
    {
      "title": "I Killed a Man on His Birthday",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=Y-7S7tkSyG4",
      "channelName": "penguinz0"
    },
    {
      "title": "so i found a mace glitch...",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=lzL1K2TrhZk",
      "channelName": "JudeLow"
    },
    {
      "title": "Crime Scene Cleaner - Part 2",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=eOwM64UVaGM",
      "channelName": "jacksepticeye"
    },
    {
      "title": "Mulberry County…",
      "youtubeVideoLink": "https://www.youtube.com/watch?v=VL3_3rYSvec",
      "channelName": "CaseOh"
    }
  ]
}
```

</details>

3. 👉 run it as many times as you want
```bash
$ bun run commands/parse.ts --schema my-schema.json --url "https://www.youtube.com/gaming"
# reused the generated playwright script: .yo-url-yo-json/scripts/www-youtube-com-f6731611d10adb05.js

$ bun run commands/parse.ts --schema my-schema.json --url "https://www.youtube.com/gaming"
# reused the generated playwright script: .yo-url-yo-json/scripts/www-youtube-com-f6731611d10adb05.js

$ bun run commands/parse.ts --schema my-schema.json --url "https://www.youtube.com/gaming"
# reused the generated playwright script: .yo-url-yo-json/scripts/www-youtube-com-f6731611d10adb05.js
```

📝 Explore additional ways to use this project in the [usage section](https://github.com/Seryiza/yo-url-yo-json#usage).

## Requirements
- bun
- codex: `codex login` or `OPENAI_API_KEY`
- optional running Chrome-based browser with CDP; [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) as fallback

## Projects using yo-url-yo-json
- [bun + typescript watcher for house.kg search result pages](https://github.com/Seryiza/housekg-telegram-notifications)

## Usage
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
