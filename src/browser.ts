import { launch as launchCloakBrowser } from "cloakbrowser";
import { chromium, type Browser } from "playwright-core";
import type { Progress } from "./progress";

const CDP_CONNECT_TIMEOUT_MS = 120_000;
const EXTERNAL_CDP_ENV = "YOYJ_CDP_ENDPOINT";
const VALID_CDP_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

type LaunchOptions = {
  headed: boolean;
  progress?: Progress;
};

type BrowserLauncherDependencies = {
  connectOverCDP: typeof chromium.connectOverCDP;
  launchLocalBrowser: typeof launchCloakBrowser;
  env: Record<string, string | undefined>;
};

const defaultDependencies: BrowserLauncherDependencies = {
  connectOverCDP: chromium.connectOverCDP.bind(chromium),
  launchLocalBrowser: launchCloakBrowser,
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

  return launchLocalCloakBrowser(options, dependencies);
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

async function launchLocalCloakBrowser(
  options: LaunchOptions,
  dependencies: BrowserLauncherDependencies,
): Promise<Browser> {
  const headless = !options.headed;

  options.progress?.info("browser provider: local npm cloakbrowser");
  options.progress?.info(`headless: ${headless}`);
  options.progress?.status("Launching local CloakBrowser...");

  try {
    const browser = await dependencies.launchLocalBrowser({ headless });
    options.progress?.status("Local CloakBrowser launched.");
    return browser;
  } catch (error) {
    throw new Error(
      [
        "Failed to launch local CloakBrowser.",
        `Headless: ${headless}`,
        `Original error: ${formatError(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }
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
