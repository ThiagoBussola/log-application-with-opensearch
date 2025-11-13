import { Transform } from "stream";
import { opensearchClient } from "../config/opensearch.config";
import { LogEntry } from "../types/log.types";
import { ErrorLogger } from "./utils/error-logger";

interface BulkInsertOptions {
  indexName: string;
  batchSize: number;
  concurrency?: number;
  serialization?: "ndjson";
  errorLogger?: ErrorLogger;
}

interface BulkInsertMetrics {
  batches: number;
  totalInserted: number;
  failedDocuments: number;
  averageBatchSize: number;
  totalDurationMs: number;
  averageBatchDurationMs: number;
  maxBatchDurationMs: number;
}

export class BulkInsertTransform extends Transform {
  private buffer: LogEntry[] = [];
  private totalInserted = 0;
  private readonly options: BulkInsertOptions;
  private readonly concurrency: number;
  private readonly serializationMode: "ndjson";
  private readonly errorLogger?: ErrorLogger;
  private pendingFlushes: Set<Promise<void>> = new Set();
  private flushError: Error | null = null;
  private batchIndex = 0;
  private metrics: Omit<BulkInsertMetrics, "averageBatchSize"> = {
    batches: 0,
    totalInserted: 0,
    failedDocuments: 0,
    totalDurationMs: 0,
    averageBatchDurationMs: 0,
    maxBatchDurationMs: 0,
  };

  constructor(options: BulkInsertOptions) {
    super({ objectMode: true });
    this.options = options;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.serializationMode = options.serialization ?? "ndjson";
    this.errorLogger = options.errorLogger;

    this.on("error", (error) => {
      this.errorLogger?.logStreamError(
        "BulkInsertTransform",
        `Stream error in bulk insert: ${error.message}`,
        error
      );
    });
  }

  async _transform(
    chunk: LogEntry,
    encoding: string,
    callback: (error?: Error | null, data?: any) => void
  ): Promise<void> {
    this.buffer.push(chunk);

    if (this.buffer.length >= this.options.batchSize) {
      const batch = this.buffer;
      this.buffer = [];
      try {
        this.scheduleFlush(batch);
        await this.waitForAvailableSlot();
        if (this.flushError) {
          callback(this.flushError);
          return;
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    } else {
      callback();
    }
  }

  async _flush(callback: (error?: Error | null) => void): Promise<void> {
    try {
      if (this.buffer.length > 0) {
        const batch = this.buffer;
        this.buffer = [];
        this.scheduleFlush(batch);
      }
      await Promise.all([...this.pendingFlushes]);
      if (this.flushError) {
        callback(this.flushError);
      } else {
        callback();
      }
    } catch (error) {
      callback(error as Error);
    }
  }

  _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void
  ): void {
    this.pendingFlushes.clear();
    this.buffer = [];
    this.flushError = error || this.flushError;
    callback(this.flushError);
  }

  private scheduleFlush(batch: LogEntry[]): void {
    if (batch.length === 0) return;

    const promise = this.sendBatch(batch)
      .catch((error) => {
        this.flushError = error;
        throw error;
      })
      .finally(() => {
        this.pendingFlushes.delete(promise);
      });

    this.pendingFlushes.add(promise);
  }

  private waitForAvailableSlot(): Promise<void> | void {
    if (this.pendingFlushes.size < this.concurrency) {
      return;
    }

    return Promise.race(this.pendingFlushes);
  }

  private async sendBatch(batch: LogEntry[]): Promise<void> {
    const currentBatchIndex = this.batchIndex++;
    let body: string;

    try {
      body = this.serializeNdjsonBatch(batch);
    } catch (error) {
      const err = error as Error;
      this.errorLogger?.logSerializationError(
        "BulkInsertTransform",
        `Failed to serialize batch ${currentBatchIndex}: ${err.message}`,
        err,
        { document: batch[0] }
      );
      throw error;
    }

    const start = Date.now();
    try {
      const response = await opensearchClient.bulk({
        body: body as any,
        refresh: false,
        wait_for_active_shards: 1,
      });

      const batchDuration = Date.now() - start;
      this.metrics.batches += 1;
      const errors = response.body.errors
        ? response.body.items.filter((item: any) => item.index?.error)
        : [];
      const successfulDocuments = batch.length - errors.length;

      this.metrics.totalInserted += successfulDocuments;
      this.metrics.totalDurationMs += batchDuration;
      this.metrics.maxBatchDurationMs = Math.max(
        this.metrics.maxBatchDurationMs,
        batchDuration
      );

      if (errors.length > 0) {
        this.metrics.failedDocuments += errors.length;
        console.error(
          `Errors in bulk insert: ${errors.length} documents failed in batch ${currentBatchIndex}`
        );

        errors.forEach((errorItem: any, idx: number) => {
          const itemIndex = response.body.items.findIndex(
            (item: any) =>
              item.index?.error &&
              item.index.error.type === errorItem.index.error.type
          );
          const docIndex = itemIndex >= 0 ? itemIndex : idx;
          const failedDoc = docIndex < batch.length ? batch[docIndex] : null;

          this.errorLogger?.logInsertionError(
            "BulkInsertTransform",
            `Document insertion failed: ${errorItem.index.error.type} - ${errorItem.index.error.reason}`,
            {
              documentId: failedDoc?.id,
              document: failedDoc,
              batchIndex: currentBatchIndex,
              opensearchError: {
                type: errorItem.index.error.type,
                reason: errorItem.index.error.reason,
              },
            }
          );

          if (idx < 5) {
            console.error(
              `  [${idx}] reason: ${errorItem.index.error.type} - ${errorItem.index.error.reason}`
            );
          }
        });

        if (errors.length > 5) {
          console.error(
            `  ...and ${
              errors.length - 5
            } more error entries (see error log file for details)`
          );
        }
      }

      this.totalInserted += successfulDocuments;
      this.push({ inserted: successfulDocuments, total: this.totalInserted });
    } catch (error) {
      const err = error as Error;
      this.errorLogger?.logConnectionError(
        "BulkInsertTransform",
        `Bulk insert request failed for batch ${currentBatchIndex}: ${err.message}`,
        err
      );
      console.error("Bulk insert failed:", error);
      throw error;
    }
  }

  getTotalInserted(): number {
    return this.totalInserted;
  }

  getMetrics(): BulkInsertMetrics {
    const averageBatchSize =
      this.metrics.batches === 0
        ? 0
        : this.metrics.totalInserted / this.metrics.batches;
    const averageBatchDurationMs =
      this.metrics.batches === 0
        ? 0
        : this.metrics.totalDurationMs / this.metrics.batches;

    return {
      batches: this.metrics.batches,
      totalInserted: this.metrics.totalInserted,
      failedDocuments: this.metrics.failedDocuments,
      averageBatchSize,
      totalDurationMs: this.metrics.totalDurationMs,
      averageBatchDurationMs,
      maxBatchDurationMs: this.metrics.maxBatchDurationMs,
    };
  }

  private serializeNdjsonBatch(batch: LogEntry[]): string {
    const lines: string[] = [];
    for (const doc of batch) {
      lines.push(JSON.stringify({ index: { _index: this.options.indexName } }));
      lines.push(JSON.stringify(doc));
    }
    return lines.join("\n") + "\n";
  }
}
