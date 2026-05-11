#!/usr/bin/env bun
import { spawnSync } from "node:child_process";

const listed = spawnSync("docker", ["ps", "-q", "--filter", "name=^/yo-url-yo-json-cloak-"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

if (listed.status !== 0) {
  process.exit(listed.status ?? 1);
}

const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
if (!ids.length) {
  console.error("No yo-url-yo-json CloakBrowser containers are running.");
  process.exit(0);
}

console.error(`Stopping ${ids.length} yo-url-yo-json CloakBrowser container(s).`);
const stopped = spawnSync("docker", ["stop", ...ids], {
  stdio: "inherit",
});

process.exit(stopped.status ?? 1);
