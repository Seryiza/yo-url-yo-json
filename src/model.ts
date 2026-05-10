import { codexExec } from "ai-sdk-provider-codex-cli";

export function createCodexModel(modelName: string, verbose: boolean) {
  return codexExec(modelName, {
    allowNpx: false,
    approvalMode: "never",
    logger: verbose ? undefined : false,
    sandboxMode: "workspace-write",
    skipGitRepoCheck: true,
  });
}
