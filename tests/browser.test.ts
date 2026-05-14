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
  const camoufoxLaunchOptionsCalls: Array<{ headless?: boolean }> = [];
  const ensureManagedCamoufoxCalls: Array<Record<string, string | undefined>> = [];
  const firefoxLaunchCalls: unknown[] = [];

  const dependencies: BrowserDependencies = {
    env,
    connectOverCDP: (async (endpoint: string, options?: { timeout?: number }) => {
      cdpCalls.push({ endpoint, timeout: options?.timeout });
      return browser;
    }) as BrowserDependencies["connectOverCDP"],
    createCamoufoxLaunchOptions: async (options) => {
      camoufoxLaunchOptionsCalls.push(options);
      return { ...options, camoufoxManaged: true };
    },
    ensureManagedCamoufox: async (env) => {
      ensureManagedCamoufoxCalls.push(env);
    },
    launchFirefox: async (options) => {
      firefoxLaunchCalls.push(options);
      return browser;
    },
  };

  return {
    browser,
    camoufoxLaunchOptionsCalls,
    cdpCalls,
    dependencies,
    ensureManagedCamoufoxCalls,
    firefoxLaunchCalls,
  };
}

describe("browser provider selection", () => {
  test("YOYJ_CDP_ENDPOINT takes precedence over local Camoufox launch", async () => {
    const {
      browser,
      camoufoxLaunchOptionsCalls,
      cdpCalls,
      dependencies,
      ensureManagedCamoufoxCalls,
      firefoxLaunchCalls,
    } = createDependencies({
      YOYJ_CDP_ENDPOINT: "http://127.0.0.1:9222",
      YOYJ_CAMOUFOX_EXECUTABLE_PATH: "/nix/store/camoufox/bin/camoufox",
    });

    await expect(launchBrowser({ headed: false }, dependencies)).resolves.toBe(browser);

    expect(cdpCalls).toEqual([{ endpoint: "http://127.0.0.1:9222", timeout: 120_000 }]);
    expect(camoufoxLaunchOptionsCalls).toEqual([]);
    expect(ensureManagedCamoufoxCalls).toEqual([]);
    expect(firefoxLaunchCalls).toEqual([]);
  });

  test("passes CDP endpoint exactly after trimming whitespace", async () => {
    const { cdpCalls, dependencies } = createDependencies({
      YOYJ_CDP_ENDPOINT: "  ws://localhost:9222/devtools/browser/session?id=1  ",
    });

    await launchBrowser({ headed: false }, dependencies);

    expect(cdpCalls[0]?.endpoint).toBe("ws://localhost:9222/devtools/browser/session?id=1");
  });

  test("rejects invalid CDP endpoint protocol with a clear error", async () => {
    const { camoufoxLaunchOptionsCalls, cdpCalls, dependencies, ensureManagedCamoufoxCalls, firefoxLaunchCalls } =
      createDependencies({
        YOYJ_CDP_ENDPOINT: "ftp://localhost:9222",
      });

    await expect(launchBrowser({ headed: false }, dependencies)).rejects.toThrow(
      "Invalid YOYJ_CDP_ENDPOINT: expected an http, https, ws, or wss URL.",
    );
    expect(cdpCalls).toEqual([]);
    expect(camoufoxLaunchOptionsCalls).toEqual([]);
    expect(ensureManagedCamoufoxCalls).toEqual([]);
    expect(firefoxLaunchCalls).toEqual([]);
  });

  test("uses local Camoufox when CDP endpoint is unset or blank", async () => {
    const unset = createDependencies();
    const blank = createDependencies({ YOYJ_CDP_ENDPOINT: "   " });

    await launchBrowser({ headed: false }, unset.dependencies);
    await launchBrowser({ headed: false }, blank.dependencies);

    expect(unset.cdpCalls).toEqual([]);
    expect(blank.cdpCalls).toEqual([]);
    expect(unset.ensureManagedCamoufoxCalls).toEqual([{}]);
    expect(blank.ensureManagedCamoufoxCalls).toEqual([{ YOYJ_CDP_ENDPOINT: "   " }]);
    expect(unset.camoufoxLaunchOptionsCalls).toEqual([{ headless: true }]);
    expect(blank.camoufoxLaunchOptionsCalls).toEqual([{ headless: true }]);
    expect(unset.firefoxLaunchCalls).toEqual([{ headless: true, camoufoxManaged: true }]);
    expect(blank.firefoxLaunchCalls).toEqual([{ headless: true, camoufoxManaged: true }]);
  });

  test("YOYJ_CAMOUFOX_EXECUTABLE_PATH selects direct executable launch", async () => {
    const { camoufoxLaunchOptionsCalls, dependencies, ensureManagedCamoufoxCalls, firefoxLaunchCalls } = createDependencies({
      YOYJ_CAMOUFOX_EXECUTABLE_PATH: "  /nix/store/camoufox/bin/camoufox  ",
    });

    await launchBrowser({ headed: false }, dependencies);

    expect(camoufoxLaunchOptionsCalls).toEqual([]);
    expect(ensureManagedCamoufoxCalls).toEqual([]);
    expect(firefoxLaunchCalls).toEqual([
      { executablePath: "/nix/store/camoufox/bin/camoufox", headless: true },
    ]);
  });

  test("falls back to camoufox-js managed launch without a direct executable", async () => {
    const { camoufoxLaunchOptionsCalls, dependencies, ensureManagedCamoufoxCalls, firefoxLaunchCalls } =
      createDependencies();

    await launchBrowser({ headed: false }, dependencies);

    expect(ensureManagedCamoufoxCalls).toEqual([{}]);
    expect(camoufoxLaunchOptionsCalls).toEqual([{ headless: true }]);
    expect(firefoxLaunchCalls).toEqual([{ headless: true, camoufoxManaged: true }]);
  });

  test("maps headed to headless false and default CLI mode to headless true", async () => {
    const headed = createDependencies();
    const defaultCliMode = createDependencies();

    await launchBrowser({ headed: true }, headed.dependencies);
    await launchBrowser({ headed: false }, defaultCliMode.dependencies);

    expect(headed.camoufoxLaunchOptionsCalls).toEqual([{ headless: false }]);
    expect(defaultCliMode.camoufoxLaunchOptionsCalls).toEqual([{ headless: true }]);
    expect(headed.firefoxLaunchCalls).toEqual([{ headless: false, camoufoxManaged: true }]);
    expect(defaultCliMode.firefoxLaunchCalls).toEqual([{ headless: true, camoufoxManaged: true }]);
  });
});
