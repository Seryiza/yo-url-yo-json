export type Logger = {
  info(message: string): void;
  warn(message: string): void;
};

export function createLogger(verbose: boolean): Logger {
  return {
    info(message: string) {
      if (verbose) {
        console.error(`[info] ${message}`);
      }
    },
    warn(message: string) {
      console.error(`[warn] ${message}`);
    },
  };
}
