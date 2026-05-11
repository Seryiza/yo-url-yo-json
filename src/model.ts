import { codexExec } from "ai-sdk-provider-codex-cli";

export function createCodexModel(modelName: string, verbose: boolean) {
  return codexExec(modelName, {
    allowNpx: false,
    approvalMode: "never",
    codexPath: "codex",
    logger: verbose ? createCodexLogger() : false,
    sandboxMode: "workspace-write",
    skipGitRepoCheck: true,
    verbose,
  });
}

function createCodexLogger() {
  return {
    debug(message: string) {
      console.error(`[codex debug] ${message}`);
    },
    info(message: string) {
      console.error(`[codex info] ${message}`);
    },
    warn(message: string) {
      console.error(`[codex warn] ${message}`);
    },
    error(message: string) {
      console.error(`[codex error] ${message}`);
    },
  };
}
