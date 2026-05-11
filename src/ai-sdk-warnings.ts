type AiSdkWarningLogger = false | ((options: { warnings: unknown[]; provider: string; model: string }) => void);

type AiSdkWarningGlobal = typeof globalThis & {
  AI_SDK_LOG_WARNINGS?: AiSdkWarningLogger;
};

export function configureAiSdkWarnings(verbose: boolean): void {
  const target = globalThis as AiSdkWarningGlobal;

  if (verbose) {
    delete target.AI_SDK_LOG_WARNINGS;
    return;
  }

  target.AI_SDK_LOG_WARNINGS = false;
}
