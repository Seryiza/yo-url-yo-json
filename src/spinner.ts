export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private readonly frames = ["-", "\\", "|", "/"];

  constructor(private readonly message: string) {}

  start(): void {
    if (this.timer) {
      return;
    }

    if (!process.stderr.isTTY) {
      process.stderr.write(`${this.message}...\n`);
      return;
    }

    this.timer = setInterval(() => {
      const frame = this.frames[this.frame % this.frames.length];
      this.frame += 1;
      process.stderr.write(`\r${frame} ${this.message}...`);
    }, 120);
  }

  stop(status?: string): void {
    if (!process.stderr.isTTY) {
      if (status) {
        process.stderr.write(`${status}\n`);
      }
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    process.stderr.write("\r\x1b[K");
    if (status) {
      process.stderr.write(`${status}\n`);
    }
  }
}
