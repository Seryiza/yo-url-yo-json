import { launchOptions as createCamoufoxLaunchOptions } from "camoufox-js";
import { CamoufoxFetcher, installedVerStr } from "camoufox-js/dist/pkgman.js";
import { chromium, firefox, type Browser } from "playwright-core";
import type { Progress } from "./progress";

const CDP_CONNECT_TIMEOUT_MS = 120_000;
const EXTERNAL_CDP_ENV = "YOYJ_CDP_ENDPOINT";
const CAMOUFOX_EXECUTABLE_ENV = "YOYJ_CAMOUFOX_EXECUTABLE_PATH";
const VALID_CDP_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

type LaunchOptions = {
  headed: boolean;
  progress?: Progress;
};

type BrowserLauncherDependencies = {
  connectOverCDP: typeof chromium.connectOverCDP;
  createCamoufoxLaunchOptions: typeof createCamoufoxLaunchOptions;
  ensureManagedCamoufox: (env: Record<string, string | undefined>) => Promise<void>;
  launchFirefox: typeof firefox.launch;
  env: Record<string, string | undefined>;
};

const defaultDependencies: BrowserLauncherDependencies = {
  connectOverCDP: chromium.connectOverCDP.bind(chromium),
  createCamoufoxLaunchOptions,
  ensureManagedCamoufox: ensureManagedCamoufoxInstalled,
  launchFirefox: firefox.launch.bind(firefox),
  env: process.env,
};

export async function launchBrowser(
  options: LaunchOptions,
  dependencies: BrowserLauncherDependencies = defaultDependencies,
): Promise<Browser> {
  const externalEndpoint = dependencies.env[EXTERNAL_CDP_ENV]?.trim();

  if (externalEndpoint) {
    return connectToExternalCdp(externalEndpoint, options, dependencies);
  }

  return launchLocalCamoufox(options, dependencies);
}

async function connectToExternalCdp(
  endpoint: string,
  options: LaunchOptions,
  dependencies: BrowserLauncherDependencies,
): Promise<Browser> {
  validateCdpEndpoint(endpoint);

  options.progress?.info(`cdp endpoint: ${endpoint}`);
  options.progress?.info("cdp connect mode: external");
  options.progress?.info(`cdp connect timeout: ${CDP_CONNECT_TIMEOUT_MS}ms`);
  options.progress?.status("Connecting Playwright over CDP...");

  try {
    const browser = await dependencies.connectOverCDP(endpoint, {
      timeout: CDP_CONNECT_TIMEOUT_MS,
    });
    options.progress?.status("Playwright connected to browser.");
    return browser;
  } catch (error) {
    throw new Error(
      [
        "Failed to connect to browser over CDP.",
        `Endpoint: ${endpoint}`,
        `Original error: ${formatError(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

async function launchLocalCamoufox(
  options: LaunchOptions,
  dependencies: BrowserLauncherDependencies,
): Promise<Browser> {
  const headless = !options.headed;
  const executablePath = dependencies.env[CAMOUFOX_EXECUTABLE_ENV]?.trim();

  if (executablePath) {
    return launchExecutableCamoufox(executablePath, headless, options, dependencies);
  }

  return launchManagedCamoufox(headless, options, dependencies);
}

async function launchExecutableCamoufox(
  executablePath: string,
  headless: boolean,
  options: LaunchOptions,
  dependencies: BrowserLauncherDependencies,
): Promise<Browser> {
  options.progress?.info("browser provider: local Camoufox executable");
  options.progress?.info(`${CAMOUFOX_EXECUTABLE_ENV}: ${executablePath}`);
  options.progress?.info(`headless: ${headless}`);
  options.progress?.status("Launching local Camoufox...");

  try {
    const browser = await dependencies.launchFirefox({ executablePath, headless });
    options.progress?.status("Local Camoufox launched.");
    return browser;
  } catch (error) {
    throw new Error(
      [
        "Failed to launch local Camoufox executable.",
        `Executable: ${executablePath}`,
        `Headless: ${headless}`,
        `Original error: ${formatError(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

async function launchManagedCamoufox(
  headless: boolean,
  options: LaunchOptions,
  dependencies: BrowserLauncherDependencies,
): Promise<Browser> {
  options.progress?.info("browser provider: local npm camoufox-js");
  options.progress?.info(`headless: ${headless}`);
  options.progress?.status("Launching local Camoufox...");

  try {
    await dependencies.ensureManagedCamoufox(dependencies.env);
    const launchOptions = await dependencies.createCamoufoxLaunchOptions({ headless });
    const browser = await dependencies.launchFirefox(launchOptions);
    options.progress?.status("Local Camoufox launched.");
    return browser;
  } catch (error) {
    throw new Error(
      [
        "Failed to launch local Camoufox via camoufox-js.",
        `Headless: ${headless}`,
        `Original error: ${formatError(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

async function ensureManagedCamoufoxInstalled(env: Record<string, string | undefined>): Promise<void> {
  if (shouldSkipBrowserDownload(env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD)) {
    return;
  }

  try {
    installedVerStr();
  } catch {
    const fetcher = new CamoufoxFetcher();
    await fetcher.install();
  }
}

function shouldSkipBrowserDownload(value: string | undefined): boolean {
  return Boolean(value && value !== "false" && value !== "0");
}

function validateCdpEndpoint(endpoint: string): void {
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid ${EXTERNAL_CDP_ENV}: expected an http, https, ws, or wss URL.`);
  }

  if (!VALID_CDP_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Invalid ${EXTERNAL_CDP_ENV}: expected an http, https, ws, or wss URL.`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
