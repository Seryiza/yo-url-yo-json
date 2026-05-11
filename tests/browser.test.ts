import { describe, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { launchBrowser } from "../src/browser";

type BrowserDependencies = NonNullable<Parameters<typeof launchBrowser>[1]>;

function createBrowserStub(): Browser {
  return {
    close: async () => undefined,
    newPage: async () => {
      throw new Error("newPage should not be called by provider tests");
    },
  } as unknown as Browser;
}

function createDependencies(env: Record<string, string | undefined> = {}) {
  const browser = createBrowserStub();
  const cdpCalls: Array<{ endpoint: string; timeout: number | undefined }> = [];
  const localLaunchCalls: Array<{ headless?: boolean } | undefined> = [];

  const dependencies: BrowserDependencies = {
    env,
    connectOverCDP: (async (endpoint: string, options?: { timeout?: number }) => {
      cdpCalls.push({ endpoint, timeout: options?.timeout });
      return browser;
    }) as BrowserDependencies["connectOverCDP"],
    launchLocalBrowser: async (options) => {
      localLaunchCalls.push(options);
      return browser;
    },
  };

  return {
    browser,
    cdpCalls,
    dependencies,
    localLaunchCalls,
  };
}

describe("browser provider selection", () => {
  test("YOYJ_CDP_ENDPOINT takes precedence over local CloakBrowser launch", async () => {
    const { browser, cdpCalls, dependencies, localLaunchCalls } = createDependencies({
      YOYJ_CDP_ENDPOINT: "http://127.0.0.1:9222",
    });

    await expect(launchBrowser({ headed: false }, dependencies)).resolves.toBe(browser);

    expect(cdpCalls).toEqual([{ endpoint: "http://127.0.0.1:9222", timeout: 120_000 }]);
    expect(localLaunchCalls).toEqual([]);
  });

  test("passes CDP endpoint exactly after trimming whitespace", async () => {
    const { cdpCalls, dependencies } = createDependencies({
      YOYJ_CDP_ENDPOINT: "  ws://localhost:9222/devtools/browser/session?id=1  ",
    });

    await launchBrowser({ headed: false }, dependencies);

    expect(cdpCalls[0]?.endpoint).toBe("ws://localhost:9222/devtools/browser/session?id=1");
  });

  test("rejects invalid CDP endpoint protocol with a clear error", async () => {
    const { cdpCalls, dependencies, localLaunchCalls } = createDependencies({
      YOYJ_CDP_ENDPOINT: "ftp://localhost:9222",
    });

    await expect(launchBrowser({ headed: false }, dependencies)).rejects.toThrow(
      "Invalid YOYJ_CDP_ENDPOINT: expected an http, https, ws, or wss URL.",
    );
    expect(cdpCalls).toEqual([]);
    expect(localLaunchCalls).toEqual([]);
  });

  test("uses local npm CloakBrowser when CDP endpoint is unset or blank", async () => {
    const unset = createDependencies();
    const blank = createDependencies({ YOYJ_CDP_ENDPOINT: "   " });

    await launchBrowser({ headed: false }, unset.dependencies);
    await launchBrowser({ headed: false }, blank.dependencies);

    expect(unset.cdpCalls).toEqual([]);
    expect(blank.cdpCalls).toEqual([]);
    expect(unset.localLaunchCalls).toEqual([{ headless: true }]);
    expect(blank.localLaunchCalls).toEqual([{ headless: true }]);
  });

  test("maps headed to headless false and default CLI mode to headless true", async () => {
    const headed = createDependencies();
    const defaultCliMode = createDependencies();

    await launchBrowser({ headed: true }, headed.dependencies);
    await launchBrowser({ headed: false }, defaultCliMode.dependencies);

    expect(headed.localLaunchCalls).toEqual([{ headless: false }]);
    expect(defaultCliMode.localLaunchCalls).toEqual([{ headless: true }]);
  });
});
