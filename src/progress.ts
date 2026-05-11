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

  status(message: string): void {
    if (this.enabled) {
      console.error(message);
    }
  }
}
