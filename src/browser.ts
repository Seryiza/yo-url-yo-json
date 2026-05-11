import { spawnSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import type { Progress } from "./progress";

const CDP_CONNECT_TIMEOUT_MS = 120_000;
const DEFAULT_CLOAKBROWSER_CACHE_VOLUME = "yo-url-yo-json-cloakbrowser-cache";

export async function launchBrowser(options: { headed: boolean; progress?: Progress }) {
  cleanupStaleContainers(options.progress);

  const port = await getFreePort();
  const fingerprint = String(randomInt(10_000, 100_000));
  const containerName = `yo-url-yo-json-cloak-${process.pid}-${randomUUID().slice(0, 8)}`;
  const image = process.env.YOYJ_CLOAKBROWSER_IMAGE ?? "cloakhq/cloakbrowser:latest";
  const cacheVolume = process.env.YOYJ_CLOAKBROWSER_CACHE_VOLUME ?? DEFAULT_CLOAKBROWSER_CACHE_VOLUME;
  const autoUpdate = process.env.YOYJ_CLOAKBROWSER_AUTO_UPDATE ?? "false";
  const args = [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-p",
    `127.0.0.1:${port}:9222`,
    "-e",
    `CLOAKBROWSER_AUTO_UPDATE=${autoUpdate}`,
  ];

  if (cacheVolume !== "none") {
    args.push("-v", `${cacheVolume}:/root/.cloakbrowser`);
  }

  args.push(image, "cloakserve");

  if (options.headed) {
    args.push("--headless=false");
  }

  options.progress?.info(`image: ${image}`);
  options.progress?.info(`container: ${containerName}`);
  options.progress?.info(`cache volume: ${cacheVolume}`);
  options.progress?.info(`auto update: ${autoUpdate}`);
  options.progress?.info(`cdp port: ${port}`);
  options.progress?.info(`fingerprint seed: ${fingerprint}`);

  options.progress?.status("Running CloakBrowser container...");
  const started = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (started.status === 0) {
    options.progress?.status("CloakBrowser container started.");
  }

  if (started.status !== 0) {
    throw new Error(
      [
        "Failed to start CloakBrowser Docker container.",
        `Image: ${image}`,
        `Command: docker ${args.join(" ")}`,
        `Error: ${started.stderr.trim() || started.stdout.trim() || `exit code ${started.status}`}`,
        "Try: bun run docker:pull",
      ].join("\n"),
    );
  }

  const endpoint = `http://127.0.0.1:${port}`;
  const connectionEndpoint = `${endpoint}?fingerprint=${encodeURIComponent(fingerprint)}`;

  try {
    options.progress?.status("Waiting for CloakBrowser CDP endpoint...");
    let wsEndpoint: string;
    try {
      wsEndpoint = await waitForCdp(endpoint, fingerprint);
      options.progress?.status("CloakBrowser CDP endpoint is ready.");
    } catch (error) {
      throw error;
    }
    options.progress?.info(`cdp endpoint: ${endpoint}`);
    options.progress?.info(`cdp connection endpoint: ${connectionEndpoint}`);
    options.progress?.info(`cdp websocket endpoint: ${wsEndpoint}`);
    options.progress?.info("cdp connect mode: http endpoint");
    options.progress?.info(`cdp connect timeout: ${CDP_CONNECT_TIMEOUT_MS}ms`);

    options.progress?.status("Connecting Playwright over CDP...");
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(connectionEndpoint, {
        timeout: CDP_CONNECT_TIMEOUT_MS,
      });
      options.progress?.status("Playwright connected to CloakBrowser.");
    } catch (error) {
      throw error;
    }
    return new DockerCloakBrowser(browser, containerName);
  } catch (error) {
    const logs = getContainerLogs(containerName);
    stopContainer(containerName);
    throw new Error(
      [
        "Failed to connect to CloakBrowser over CDP.",
        `Container: ${containerName}`,
        `Endpoint: ${connectionEndpoint}`,
        `Original error: ${formatError(error)}`,
        logs ? `Container logs:\n${logs}` : "Container logs: <empty>",
      ].join("\n"),
      { cause: error },
    );
  }
}

class DockerCloakBrowser {
  constructor(
    private readonly browser: Browser,
    private readonly containerName: string,
  ) {}

  async newPage(): Promise<Page> {
    return this.browser.newPage();
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
    stopContainer(this.containerName);
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Failed to allocate a local port for CloakBrowser CDP."));
        }
      });
    });
  });
}

async function waitForCdp(endpoint: string, fingerprint: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  const versionEndpoint = `${endpoint}/json/version?fingerprint=${encodeURIComponent(fingerprint)}`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(versionEndpoint);
      if (response.ok) {
        const body = (await response.json()) as { webSocketDebuggerUrl?: unknown };
        if (typeof body.webSocketDebuggerUrl === "string" && body.webSocketDebuggerUrl.length > 0) {
          return body.webSocketDebuggerUrl;
        }
        lastError = "missing webSocketDebuggerUrl in /json/version";
      } else {
        lastError = `${response.status} ${response.statusText}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(250);
  }

  throw new Error(
    [
      "Timed out waiting for CloakBrowser CDP server.",
      `Endpoint: ${versionEndpoint}`,
      `Last error: ${lastError || "none"}`,
    ].join("\n"),
  );
}

function stopContainer(containerName: string): void {
  spawnSync("docker", ["stop", containerName], {
    stdio: "ignore",
  });
}

function cleanupStaleContainers(progress?: Progress): void {
  const listed = spawnSync("docker", ["ps", "-q", "--filter", "name=^/yo-url-yo-json-cloak-"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
  if (!ids.length) {
    return;
  }

  progress?.warn(`stopping ${ids.length} stale CloakBrowser container(s) from previous runs`);
  spawnSync("docker", ["stop", ...ids], {
    stdio: "ignore",
  });
}

function getContainerLogs(containerName: string): string {
  const logs = spawnSync("docker", ["logs", "--tail", "80", containerName], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return [logs.stdout, logs.stderr].filter(Boolean).join("\n").trim();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
