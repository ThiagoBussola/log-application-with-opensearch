import { Transform } from "stream";

interface ProgressData {
  inserted: number;
  total: number;
}

export class ProgressTracker extends Transform {
  private startTime: number;
  private lastUpdate: number;
  private expectedTotal: number;

  constructor(expectedTotal: number) {
    super({ objectMode: true });
    this.startTime = Date.now();
    this.lastUpdate = Date.now();
    this.expectedTotal = expectedTotal;
  }

  _transform(
    chunk: ProgressData,
    encoding: string,
    callback: (error?: Error | null) => void
  ): void {
    const now = Date.now();

    if (now - this.lastUpdate > 2000) {
      const elapsed = (now - this.startTime) / 1000;
      const rate = chunk.total / elapsed;
      const remaining = this.expectedTotal - chunk.total;
      const eta = remaining / rate;
      const percentage = ((chunk.total / this.expectedTotal) * 100).toFixed(2);

      console.log(
        `Progress: ${chunk.total.toLocaleString()}/${this.expectedTotal.toLocaleString()} ` +
          `(${percentage}%) | ` +
          `Rate: ${Math.round(rate)}/s | ` +
          `ETA: ${Math.round(eta)}s`
      );

      this.lastUpdate = now;
    }

    callback();
  }

  _flush(callback: (error?: Error | null) => void): void {
    callback();
  }
}
