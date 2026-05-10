import { Spinner } from "./spinner";

export class Progress {
  private current = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly total: number,
  ) {}

  step(message: string): void {
    if (!this.enabled) {
      return;
    }

    this.current += 1;
    console.error(`[step ${this.current}/${this.total}] ${message}`);
  }

  info(message: string): void {
    if (this.enabled) {
      console.error(`[info] ${message}`);
    }
  }

  warn(message: string): void {
    console.error(`[warn] ${message}`);
  }

  spinner(message: string): ProgressSpinner {
    return new ProgressSpinner(this.enabled, message);
  }
}

class ProgressSpinner {
  private readonly spinner: Spinner | null;

  constructor(
    enabled: boolean,
    message: string,
  ) {
    this.spinner = enabled ? new Spinner(message) : null;
  }

  start(): void {
    this.spinner?.start();
  }

  stop(status?: string): void {
    this.spinner?.stop(status);
  }
}
