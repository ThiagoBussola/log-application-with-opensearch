import { generateLogs, GenerateLogsResult } from "./generate-logs";
import {
  setupIndexTemplate,
  createBulkOptimizedIndex,
  optimizeIndexForSearch,
} from "../opensearch/setup";
import {
  opensearchClient,
  testConnection,
  closeClient,
} from "../config/opensearch.config";
import { ErrorLogger } from "./utils/error-logger";

interface StreamIngestionOptions {
  totalLogs: number;
  batchSize: number;
  concurrency: number;
  indexName: string;
  baseDate: Date;
  forceRecreate: boolean;
  serialization: "ndjson";
}

function parseArgs(): StreamIngestionOptions {
  const args = process.argv.slice(2);
  const defaultBaseDate = new Date().toISOString().split("T")[0];

  const options: StreamIngestionOptions = {
    totalLogs: 500_000,
    batchSize: 5_000,
    concurrency: 2,
    indexName: `logs-stream-${defaultBaseDate}`,
    baseDate: new Date(defaultBaseDate),
    forceRecreate: false,
    serialization: "ndjson",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [flag, inlineValue] = arg.includes("=")
      ? arg.split("=")
      : [arg, args[i + 1]];
    const value = inlineValue;

    switch (flag) {
      case "--total":
        if (value) options.totalLogs = Number(value);
        if (!arg.includes("=")) i++;
        break;
      case "--batch":
      case "--batch-size":
        if (value) options.batchSize = Number(value);
        if (!arg.includes("=")) i++;
        break;
      case "--concurrency":
        if (value) options.concurrency = Math.max(1, Number(value));
        if (!arg.includes("=")) i++;
        break;
      case "--index":
        if (value) options.indexName = value;
        if (!arg.includes("=")) i++;
        break;
      case "--date":
        if (value) options.baseDate = new Date(value);
        if (!arg.includes("=")) i++;
        break;
      case "--force":
      case "--force-recreate":
        options.forceRecreate = true;
        break;
      case "--serialization":
        if (value && value.toLowerCase() === "ndjson") {
          options.serialization = "ndjson";
        } else {
          console.warn(`Serialization mode must be "ndjson". Using default.`);
        }
        if (!arg.includes("=")) i++;
        break;
      default:
        console.warn(`Unknown flag ignored: ${flag}`);
    }
  }

  return options;
}

async function ensureIndex(
  indexName: string,
  forceRecreate: boolean
): Promise<void> {
  const exists = await opensearchClient.indices.exists({ index: indexName });
  const alreadyExists = Boolean(exists.body);

  if (alreadyExists && forceRecreate) {
    await opensearchClient.indices.delete({ index: indexName });
  } else if (alreadyExists && !forceRecreate) {
    return;
  }

  await createBulkOptimizedIndex(indexName);
}

async function runIngestion(): Promise<void> {
  const options = parseArgs();

  console.log(
    `\nStream Ingestion: ${options.totalLogs.toLocaleString()} logs → ${
      options.indexName
    }`
  );

  const connected = await testConnection();
  if (!connected) {
    console.error("Unable to connect to OpenSearch cluster. Aborting.");
    process.exit(1);
    return;
  }

  const setupStartTime = Date.now();
  await setupIndexTemplate();
  await ensureIndex(options.indexName, options.forceRecreate);
  const setupDuration = (Date.now() - setupStartTime) / 1000;

  const errorLogger = new ErrorLogger(
    "./logs",
    `errors-${options.indexName}-${Date.now()}.json`
  );

  const ingestionStartTime = Date.now();
  let result: GenerateLogsResult;

  try {
    result = await generateLogs({
      indexName: options.indexName,
      totalLogs: options.totalLogs,
      batchSize: options.batchSize,
      concurrency: options.concurrency,
      baseDate: options.baseDate,
      serialization: options.serialization,
      errorLogger,
    });
  } catch (error) {
    console.error("Ingestion failed:", error);
    errorLogger.flush();
    await closeClient();
    process.exit(1);
    return;
  }

  const ingestionDuration = (Date.now() - ingestionStartTime) / 1000;

  const optimizationStartTime = Date.now();
  let optimizationDuration = 0;
  try {
    await optimizeIndexForSearch(options.indexName);
    optimizationDuration = (Date.now() - optimizationStartTime) / 1000;
  } catch (error) {
    console.warn("Warning: Failed to optimize index for search:", error);
    optimizationDuration = (Date.now() - optimizationStartTime) / 1000;
  }

  const totalDuration = (Date.now() - setupStartTime) / 1000;

  console.log(
    `\nSummary: ${result.totalInserted.toLocaleString()} logs inserted`
  );
  console.log(`Throughput: ${result.averageRatePerSecond.toFixed(0)} logs/sec`);
  console.log(
    `Time: ${totalDuration.toFixed(2)}s (setup: ${setupDuration.toFixed(
      2
    )}s, ingest: ${ingestionDuration.toFixed(
      2
    )}s, optimize: ${optimizationDuration.toFixed(2)}s)`
  );

  if (result.bulkMetrics.failedDocuments > 0) {
    console.log(
      `Failed: ${result.bulkMetrics.failedDocuments.toLocaleString()} documents`
    );
  }

  const errorCount = errorLogger.getErrorCount();
  if (errorCount > 0) {
    console.log(
      `Errors: ${errorCount} (details: ${errorLogger.getLogFilePath()})`
    );
  }

  errorLogger.flush();
  await closeClient();
  process.exit(result.bulkMetrics.failedDocuments > 0 ? 1 : 0);
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
  closeClient()
    .then(() => process.exit(1))
    .catch(() => process.exit(1));
});

process.on("SIGINT", async () => {
  console.log("\nReceived SIGINT, cleaning up...");
  await closeClient();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nReceived SIGTERM, cleaning up...");
  await closeClient();
  process.exit(0);
});

runIngestion().catch(async (error) => {
  console.error("Fatal error:", error);
  await closeClient();
  process.exit(1);
});
