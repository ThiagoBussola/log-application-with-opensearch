import { Readable, pipeline } from "stream";
import { promisify } from "util";
import { generateLog } from "./generators/log-generator";
import { BulkInsertTransform } from "./bulk-insert";
import { ProgressTracker } from "./progress-tracker";
import { LogEntry } from "../types/log.types";
import {
  LogMetricsCollector,
  LogMetricsSnapshot,
} from "./transforms/log-metrics-collector";
import { ErrorLogger } from "./utils/error-logger";
import { testConnection } from "../config/opensearch.config";

const pipelineAsync = promisify(pipeline);
const DEFAULT_CHUNK_SIZE = 100;

interface GenerateLogsOptions {
  totalLogs: number;
  indexName: string;
  batchSize?: number;
  concurrency?: number;
  baseDate?: Date;
  generator?: (context: { index: number; baseDate: Date }) => LogEntry;
  serialization?: "ndjson";
  errorLogger?: ErrorLogger;
}

export interface GenerateLogsResult {
  totalInserted: number;
  totalTimeSeconds: number;
  averageRatePerSecond: number;
  bulkMetrics: {
    batches: number;
    totalInserted: number;
    failedDocuments: number;
    averageBatchSize: number;
    totalDurationMs: number;
    averageBatchDurationMs: number;
    maxBatchDurationMs: number;
  };
  logMetrics: LogMetricsSnapshot;
}

class LogGeneratorStream extends Readable {
  private generated = 0;
  private readonly total: number;
  private readonly baseDate: Date;
  private readonly generatorFn: (context: {
    index: number;
    baseDate: Date;
  }) => LogEntry;

  constructor(
    total: number,
    baseDate: Date = new Date(),
    generatorFn: (context: { index: number; baseDate: Date }) => LogEntry
  ) {
    super({ objectMode: true });
    this.total = total;
    this.baseDate = baseDate;
    this.generatorFn = generatorFn;
  }

  _read(): void {
    if (this.generated >= this.total) {
      this.push(null);
      return;
    }

    const chunkSize = Math.min(DEFAULT_CHUNK_SIZE, this.total - this.generated);

    setImmediate(() => {
      for (let i = 0; i < chunkSize; i++) {
        const log = this.generatorFn({
          index: this.generated,
          baseDate: this.baseDate,
        });
        this.push(log);
        this.generated++;
      }
    });
  }
}

export async function generateLogs(
  options: GenerateLogsOptions
): Promise<GenerateLogsResult> {
  const {
    totalLogs,
    indexName,
    batchSize = 1000,
    concurrency = 1,
    baseDate = new Date(),
    generator,
    serialization = "ndjson",
  } = options;

  console.log(
    `\nGenerating ${totalLogs.toLocaleString()} logs to index: ${indexName}`
  );

  const startTime = Date.now();

  const generatorStream = new LogGeneratorStream(
    totalLogs,
    baseDate,
    generator ??
      (({ baseDate: date }) => {
        return generateLog(date);
      })
  );
  const metricsCollector = new LogMetricsCollector();
  const bulkInsertStream = new BulkInsertTransform({
    indexName,
    batchSize,
    concurrency,
    serialization,
    errorLogger: options.errorLogger,
  });
  const progressTracker = new ProgressTracker(totalLogs);

  generatorStream.on("error", (error) => {
    options.errorLogger?.logStreamError(
      "LogGeneratorStream",
      `Error generating log: ${error.message}`,
      error
    );
  });

  metricsCollector.on("error", (error) => {
    options.errorLogger?.logStreamError(
      "LogMetricsCollector",
      `Error collecting metrics: ${error.message}`,
      error
    );
  });

  progressTracker.on("error", (error) => {
    options.errorLogger?.logStreamError(
      "ProgressTracker",
      `Error tracking progress: ${error.message}`,
      error
    );
  });

  try {
    await pipelineAsync(
      generatorStream,
      metricsCollector,
      bulkInsertStream,
      progressTracker
    );

    if (!generatorStream.destroyed) {
      generatorStream.destroy();
    }
    if (!metricsCollector.destroyed) {
      metricsCollector.destroy();
    }
    if (!bulkInsertStream.destroyed) {
      bulkInsertStream.destroy();
    }
    if (!progressTracker.destroyed) {
      progressTracker.destroy();
    }

    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    const avgRate = totalLogs / totalTime;
    const bulkMetrics = bulkInsertStream.getMetrics();
    const logMetrics = metricsCollector.getSnapshot();

    console.log(
      `\nCompleted: ${bulkInsertStream
        .getTotalInserted()
        .toLocaleString()} logs in ${totalTime.toFixed(2)}s (${Math.round(
        avgRate
      )} logs/sec)`
    );

    if (bulkMetrics.failedDocuments > 0) {
      console.log(
        `Failed: ${bulkMetrics.failedDocuments.toLocaleString()} documents`
      );
    }

    options.errorLogger?.flush();

    return {
      totalInserted: bulkInsertStream.getTotalInserted(),
      totalTimeSeconds: totalTime,
      averageRatePerSecond: avgRate,
      bulkMetrics,
      logMetrics,
    };
  } catch (error) {
    const err = error as Error;
    options.errorLogger?.logStreamError(
      "generateLogs",
      `Fatal error in log generation pipeline: ${err.message}`,
      err
    );
    options.errorLogger?.flush();
    console.error(`Error generating logs:`, error);
    throw error;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const totalLogs = parseInt(args[0]) || 200_000;
  const indexDate = args[1] || new Date().toISOString().split("T")[0];
  const indexName = `logs-${indexDate}`;

  (async () => {
    const connected = await testConnection();
    if (!connected) {
      console.error("Cannot connect to OpenSearch");
      process.exit(1);
    }

    await generateLogs({
      totalLogs,
      indexName,
      batchSize: 1000,
      concurrency: 1,
      baseDate: new Date(indexDate),
      serialization: "ndjson",
    });

    process.exit(0);
  })().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
