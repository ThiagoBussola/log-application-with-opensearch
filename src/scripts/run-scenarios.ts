import { opensearchClient } from "../config/opensearch.config";
import { setupIndexTemplate } from "../opensearch/setup";
import { generateLogs, GenerateLogsResult } from "./generate-logs";
import { generateLog } from "./generators/log-generator";
import { LogEntry } from "../types/log.types";

interface CliOptions {
  scenarioIds: string[];
  totalLogsOverride?: number;
  concurrencyOverride?: number;
  batchSizeOverride?: number;
  indexPrefix?: string;
  forceRecreate?: boolean;
}

interface ScenarioContext {
  baseDate: Date;
  options: CliOptions;
}

interface ScenarioIngestionConfig {
  indexName: string;
  description: string;
  totalLogs: number;
  batchSize: number;
  concurrency: number;
  baseDate: Date;
  generator?: (context: { index: number; baseDate: Date }) => LogEntry;
}

interface QuerySummary {
  title: string;
  details: Record<string, unknown>;
}

interface ScenarioDefinition {
  id: string;
  title: string;
  description: string;
  buildIngestion: (ctx: ScenarioContext) => ScenarioIngestionConfig;
  queryRunners: (ctx: ScenarioContext) => QueryTask[];
}

interface QueryTask {
  description: string;
  execute: (params: QueryTaskParams) => Promise<QuerySummary | QuerySummary[]>;
}

interface QueryTaskParams {
  indexName: string;
  baseDate: Date;
}

interface ScenarioResult {
  definition: ScenarioDefinition;
  ingestionResult: GenerateLogsResult;
  querySummaries: Array<QuerySummary | QuerySummary[]>;
}

const DEFAULT_OPTIONS: CliOptions = {
  scenarioIds: [],
  totalLogsOverride: undefined,
  concurrencyOverride: undefined,
  batchSizeOverride: undefined,
  indexPrefix: "logs",
  forceRecreate: false,
};

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const [flag, value] = arg.includes("=")
      ? arg.split("=")
      : [arg, args[i + 1]];

    switch (flag) {
      case "--scenario":
      case "--scenarios": {
        const scenariosValue = value?.split(",").map((id) => id.trim());
        if (scenariosValue?.length) {
          options.scenarioIds = scenariosValue;
        }
        if (!arg.includes("=")) i++;
        break;
      }
      case "--total":
        options.totalLogsOverride = Number(value);
        if (!arg.includes("=")) i++;
        break;
      case "--concurrency":
        options.concurrencyOverride = Number(value);
        if (!arg.includes("=")) i++;
        break;
      case "--batch":
      case "--batch-size":
        options.batchSizeOverride = Number(value);
        if (!arg.includes("=")) i++;
        break;
      case "--prefix":
        options.indexPrefix = value || options.indexPrefix;
        if (!arg.includes("=")) i++;
        break;
      case "--force":
      case "--force-recreate":
        options.forceRecreate = true;
        break;
      default:
        console.warn(`Unknown flag: ${flag}`);
    }
  }

  return options;
}

async function ensureFreshIndex(
  indexName: string,
  forceRecreate: boolean
): Promise<void> {
  const exists = await opensearchClient.indices.exists({ index: indexName });

  if (exists.body && forceRecreate) {
    console.log(
      `Deleting existing index ${indexName} (force recreate enabled)`
    );
    await opensearchClient.indices.delete({ index: indexName });
  } else if (exists.body && !forceRecreate) {
    console.log(
      `Index ${indexName} already exists. Reusing existing data (use --force to recreate).`
    );
    return;
  }

  console.log(`Creating index ${indexName}`);
  await opensearchClient.indices.create({ index: indexName });
}

function formatIndexName(prefix: string, suffix: string, date: Date): string {
  const datePart = date.toISOString().split("T")[0];
  return `${prefix}-${suffix}-${datePart}`.replace(/[^a-zA-Z0-9-_]/g, "-");
}

function buildScenarioDefinitions(): ScenarioDefinition[] {
  return [
    {
      id: "massive-bulk",
      title: "Massive Bulk Ingestion",
      description:
        "High-volume ingestion with configurable concurrency to stress bulk indexing throughput.",
      buildIngestion: ({ baseDate, options }): ScenarioIngestionConfig => {
        const total = options.totalLogsOverride ?? 500_000;
        const batch = options.batchSizeOverride ?? 5_000;
        const concurrency = options.concurrencyOverride ?? 4;
        const indexName = formatIndexName(
          options.indexPrefix || "logs",
          "massive",
          baseDate
        );

        return {
          indexName,
          description: `Ingesting ${total.toLocaleString()} synthetic logs with batch size ${batch} and concurrency ${concurrency}.`,
          totalLogs: total,
          batchSize: batch,
          concurrency,
          baseDate,
        };
      },
      queryRunners: () => [
        {
          description: "Log level distribution",
          execute: ({ indexName }) => runLevelAggregation(indexName),
        },
        {
          description: "Top services by volume",
          execute: ({ indexName }) => runServiceAggregation(indexName),
        },
        {
          description: "Response time percentiles",
          execute: ({ indexName }) => runLatencyPercentiles(indexName),
        },
      ],
    },
    {
      id: "query-diversity",
      title: "Query Diversity and Filtering",
      description:
        "Generates moderately sized dataset with balanced services to showcase varied query patterns.",
      buildIngestion: ({ baseDate, options }): ScenarioIngestionConfig => {
        const total = options.totalLogsOverride ?? 200_000;
        const batch = options.batchSizeOverride ?? 2_500;
        const concurrency = options.concurrencyOverride ?? 2;
        const indexName = formatIndexName(
          options.indexPrefix || "logs",
          "queries",
          baseDate
        );

        const generator = ({
          baseDate: date,
        }: {
          index: number;
          baseDate: Date;
        }) => {
          const log = generateLog(date);

          // Introduce more balanced environments
          const environments: LogEntry["service"]["environment"][] = [
            "production",
            "staging",
            "development",
          ];
          log.service.environment =
            environments[Math.floor(Math.random() * environments.length)];

          // Increase warn/error ratio slightly
          if (Math.random() < 0.15) {
            log.level = "warn";
          } else if (Math.random() < 0.08) {
            log.level = "error";
          }

          return log;
        };

        return {
          indexName,
          description: `Ingesting ${total.toLocaleString()} logs with diversified environments and higher warning/error ratio.`,
          totalLogs: total,
          batchSize: batch,
          concurrency,
          baseDate,
          generator,
        };
      },
      queryRunners: () => [
        {
          description: "Environment vs error rate",
          execute: ({ indexName }) => runEnvironmentErrorRate(indexName),
        },
        {
          description: "Search slow API requests",
          execute: ({ indexName }) => runSlowRequestSearch(indexName),
        },
        {
          description: "Daily log volume time series (2h buckets)",
          execute: ({ indexName }) => runTimeSeriesAggregation(indexName),
        },
      ],
    },
    {
      id: "failure-recovery",
      title: "Failure Injection and Recovery",
      description:
        "Simulates ingestion with intentionally malformed documents to observe error handling metrics.",
      buildIngestion: ({ baseDate, options }): ScenarioIngestionConfig => {
        const total = options.totalLogsOverride ?? 100_000;
        const batch = options.batchSizeOverride ?? 2_000;
        const concurrency = options.concurrencyOverride ?? 3;
        const indexName = formatIndexName(
          options.indexPrefix || "logs",
          "failure",
          baseDate
        );

        const generator = ({
          baseDate: date,
          index,
        }: {
          index: number;
          baseDate: Date;
        }) => {
          const log = generateLog(date);

          // Every ~50th log we remove the timestamp to trigger a mapping error
          if (index % 50 === 0) {
            const malformed: any = { ...log };
            delete malformed.timestamp;
            return malformed as LogEntry;
          }

          // Increase fatal logs to observe alerting
          if (Math.random() < 0.02) {
            log.level = "fatal";
          }

          return log;
        };

        return {
          indexName,
          description: `Ingesting ${total.toLocaleString()} logs with simulated malformed events (approx. 2% missing timestamp).`,
          totalLogs: total,
          batchSize: batch,
          concurrency,
          baseDate,
          generator,
        };
      },
      queryRunners: () => [
        {
          description: "Count of documents missing timestamp",
          execute: ({ indexName }) => runMissingTimestampCheck(indexName),
        },
        {
          description: "Fatal vs error breakdown",
          execute: ({ indexName }) =>
            runLevelAggregation(indexName, ["error", "fatal"]),
        },
        {
          description: "Retry candidates (logs failing to ingest)",
          execute: ({ indexName }) => runFailedDocumentsLookup(indexName),
        },
      ],
    },
    {
      id: "search-experiments",
      title: "Search Relevance Exploration",
      description:
        "Exercises full-text search patterns (match, phrase proximity, fuzzy) to validate OpenSearch query behavior.",
      buildIngestion: ({ baseDate, options }): ScenarioIngestionConfig => {
        const total = options.totalLogsOverride ?? 150_000;
        const batch = options.batchSizeOverride ?? 2_500;
        const concurrency = options.concurrencyOverride ?? 2;
        const indexName = formatIndexName(
          options.indexPrefix || "logs",
          "search",
          baseDate
        );

        const keywordPhrases = [
          "payment gateway timeout error",
          "user authentication successful",
          "order processing completed",
          "high latency detected",
          "inventory synchronization delayed",
        ];

        const generator = ({
          baseDate: date,
          index,
        }: {
          index: number;
          baseDate: Date;
        }) => {
          const log = generateLog(date);
          const phrase = keywordPhrases[index % keywordPhrases.length];
          const proximityVariant = phrase.replace(" ", " near ");

          if (index % 2 === 0) {
            log.message = phrase;
            log.tags = [...new Set([...log.tags, "search-demo"])];
          } else if (index % 5 === 0) {
            log.message = `${phrase} resolved after retry`;
            log.tags = [...new Set([...log.tags, "search-demo", "retry"])];
          } else if (index % 7 === 0) {
            log.message = `${proximityVariant} detected`;
            log.tags = [...new Set([...log.tags, "search-demo", "near-match"])];
          }

          return log;
        };

        return {
          indexName,
          description: `Ingesting ${total.toLocaleString()} logs with curated search phrases for relevance testing.`,
          totalLogs: total,
          batchSize: batch,
          concurrency,
          baseDate,
          generator,
        };
      },
      queryRunners: () => [
        {
          description: "Exact match query on log message",
          execute: ({ indexName }) => runMatchQuery(indexName),
        },
        {
          description: "Phrase proximity search with slop",
          execute: ({ indexName }) => runPhraseProximityQuery(indexName),
        },
        {
          description: "Fuzzy multi-match for typo tolerance",
          execute: ({ indexName }) => runFuzzyMultiMatchQuery(indexName),
        },
      ],
    },
  ];
}

async function runLevelAggregation(
  indexName: string,
  includeLevels?: string[]
): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      size: 0,
      aggs: {
        levels: {
          terms: {
            field: "level",
            size: includeLevels ? includeLevels.length : 10,
            include: includeLevels,
          },
        },
      },
    },
  });

  const aggregations = response.body.aggregations as any;
  const buckets =
    aggregations?.levels?.buckets?.map((bucket: any) => ({
      level: bucket.key,
      count: bucket.doc_count,
    })) || [];

  return {
    title: "Log level distribution",
    details: {
      buckets,
    },
  };
}

async function runServiceAggregation(indexName: string): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      size: 0,
      aggs: {
        services: {
          terms: {
            field: "service.name",
            size: 10,
          },
        },
      },
    },
  });

  const aggregations = response.body.aggregations as any;
  const buckets =
    aggregations?.services?.buckets?.map((bucket: any) => ({
      service: bucket.key,
      count: bucket.doc_count,
    })) || [];

  return {
    title: "Top services",
    details: {
      buckets,
    },
  };
}

async function runLatencyPercentiles(indexName: string): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      size: 0,
      aggs: {
        latency: {
          percentiles: {
            field: "metrics.response_time_ms",
            percents: [50, 75, 90, 95, 99],
          },
        },
      },
    },
  });

  const aggregations = response.body.aggregations as any;
  const values = aggregations?.latency?.values || {};

  return {
    title: "Response time percentiles",
    details: values,
  };
}

async function runEnvironmentErrorRate(
  indexName: string
): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      size: 0,
      aggs: {
        environments: {
          terms: {
            field: "service.environment",
            size: 10,
          },
          aggs: {
            errors: {
              filter: {
                exists: { field: "error" },
              },
            },
          },
        },
      },
    },
  });

  const aggregations = response.body.aggregations as any;
  const buckets =
    aggregations?.environments?.buckets?.map((bucket: any) => ({
      environment: bucket.key,
      total: bucket.doc_count,
      errorCount: bucket.errors.doc_count,
      errorRate:
        bucket.doc_count > 0
          ? Number(
              ((bucket.errors.doc_count / bucket.doc_count) * 100).toFixed(2)
            )
          : 0,
    })) || [];

  return {
    title: "Error rate by environment",
    details: {
      buckets,
    },
  };
}

async function runSlowRequestSearch(indexName: string): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      query: {
        range: {
          "metrics.response_time_ms": {
            gte: 2000,
          },
        },
      },
      sort: [{ "metrics.response_time_ms": { order: "desc" } }],
      size: 5,
      _source: [
        "timestamp",
        "service.name",
        "request.path",
        "metrics.response_time_ms",
        "level",
      ],
    },
  });

  const hits =
    response.body.hits?.hits?.map((hit: any) => ({
      id: hit._id,
      ...hit._source,
    })) || [];

  return {
    title: "Top slow requests (>2s)",
    details: {
      hits,
    },
  };
}

async function runMatchQuery(indexName: string): Promise<QuerySummary> {
  const searchPhrase = "payment gateway timeout error";
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      query: {
        match: {
          message: {
            query: searchPhrase,
            operator: "and",
          },
        },
      },
      size: 5,
      highlight: {
        fields: {
          message: {},
        },
      },
    },
  });

  const hits =
    response.body.hits?.hits?.map((hit: any) => ({
      id: hit._id,
      score: hit._score,
      message: hit._source?.message,
      tags: hit._source?.tags,
      highlight: hit.highlight,
    })) || [];

  return {
    title: "Match query results",
    details: {
      phrase: searchPhrase,
      hits,
    },
  };
}

async function runPhraseProximityQuery(
  indexName: string
): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      query: {
        match_phrase: {
          message: {
            query: "inventory synchronization delayed",
            slop: 2,
          },
        },
      },
      size: 5,
      highlight: {
        fields: {
          message: {},
        },
      },
    },
  });

  const hits =
    response.body.hits?.hits?.map((hit: any) => ({
      id: hit._id,
      score: hit._score,
      message: hit._source?.message,
      highlight: hit.highlight,
    })) || [];

  return {
    title: "Phrase proximity query results",
    details: {
      phrase: "inventory synchronization delayed",
      slop: 2,
      hits,
    },
  };
}

async function runFuzzyMultiMatchQuery(
  indexName: string
): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      query: {
        multi_match: {
          query: "user authentikation succesful",
          fields: ["message", "tags"],
          fuzziness: "AUTO",
        },
      },
      size: 5,
      highlight: {
        fields: {
          message: {},
        },
      },
    },
  });

  const hits =
    response.body.hits?.hits?.map((hit: any) => ({
      id: hit._id,
      score: hit._score,
      message: hit._source?.message,
      tags: hit._source?.tags,
      highlight: hit.highlight,
    })) || [];

  return {
    title: "Fuzzy multi-match results",
    details: {
      query: "user authentikation succesful",
      hits,
    },
  };
}

async function runTimeSeriesAggregation(
  indexName: string
): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      size: 0,
      aggs: {
        timeline: {
          date_histogram: {
            field: "timestamp",
            fixed_interval: "2h",
          },
        },
      },
    },
  });

  const aggregations = response.body.aggregations as any;
  const buckets =
    aggregations?.timeline?.buckets?.map((bucket: any) => ({
      timestamp: new Date(bucket.key).toISOString(),
      count: bucket.doc_count,
    })) || [];

  return {
    title: "Time series (2h buckets)",
    details: {
      buckets,
    },
  };
}

async function runMissingTimestampCheck(
  indexName: string
): Promise<QuerySummary> {
  const response = await opensearchClient.count({
    index: indexName,
    body: {
      query: {
        bool: {
          must_not: [{ exists: { field: "timestamp" } }],
        },
      },
    },
  } as any);

  return {
    title: "Documents missing timestamp",
    details: {
      count: response.body.count,
    },
  };
}

async function runFailedDocumentsLookup(
  indexName: string
): Promise<QuerySummary> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      query: {
        term: {
          "level.keyword": "fatal",
        },
      },
      size: 5,
      _source: [
        "timestamp",
        "service.name",
        "level",
        "message",
        "error.type",
        "error.message",
      ],
    },
  });

  const hits =
    response.body.hits?.hits?.map((hit: any) => ({
      id: hit._id,
      ...hit._source,
    })) || [];

  return {
    title: "Fatal logs for follow-up analysis",
    details: {
      hits,
    },
  };
}

async function runScenario(
  definition: ScenarioDefinition,
  context: ScenarioContext
): Promise<ScenarioResult> {
  console.log(`\n=== Scenario: ${definition.title} ===`);
  console.log(definition.description);

  const ingestion = definition.buildIngestion(context);

  console.log(`\nIndex target: ${ingestion.indexName}`);
  console.log(ingestion.description);

  await ensureFreshIndex(
    ingestion.indexName,
    context.options.forceRecreate ?? false
  );

  const ingestionResult = await generateLogs({
    indexName: ingestion.indexName,
    totalLogs: ingestion.totalLogs,
    batchSize: ingestion.batchSize,
    concurrency: ingestion.concurrency,
    baseDate: ingestion.baseDate,
    generator: ingestion.generator,
  });

  console.log("\nBulk metrics:");
  console.table({
    batches: ingestionResult.bulkMetrics.batches,
    totalInserted: ingestionResult.bulkMetrics.totalInserted,
    failedDocuments: ingestionResult.bulkMetrics.failedDocuments,
    avgBatchSize: Math.round(ingestionResult.bulkMetrics.averageBatchSize),
    avgBatchDurationMs:
      ingestionResult.bulkMetrics.averageBatchDurationMs.toFixed(2),
    maxBatchDurationMs: ingestionResult.bulkMetrics.maxBatchDurationMs,
  });

  const querySummaries: Array<QuerySummary | QuerySummary[]> = [];
  const queryTasks = definition.queryRunners(context);

  for (const task of queryTasks) {
    console.log(`\nRunning query: ${task.description}`);
    const summary = await task.execute({
      indexName: ingestion.indexName,
      baseDate: ingestion.baseDate,
    });
    querySummaries.push(summary);
    console.dir(summary, { depth: null });
  }

  return {
    definition,
    ingestionResult,
    querySummaries,
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const context: ScenarioContext = {
    baseDate: new Date(),
    options,
  };

  console.log("Initializing OpenSearch test scenarios...\n");
  await setupIndexTemplate();

  const definitions = buildScenarioDefinitions();
  const selected =
    options.scenarioIds.length > 0
      ? definitions.filter((definition) =>
          options.scenarioIds.includes(definition.id)
        )
      : definitions;

  if (selected.length === 0) {
    console.error(
      "No matching scenarios found. Use --scenario to specify a valid scenario id."
    );
    process.exit(1);
    return;
  }

  const results: ScenarioResult[] = [];
  for (const definition of selected) {
    try {
      const result = await runScenario(definition, context);
      results.push(result);
    } catch (error) {
      console.error(
        `Scenario ${definition.id} failed with error:`,
        (error as Error).message
      );
    }
  }

  console.log("\n=== Scenario Summary ===");
  results.forEach((result) => {
    const { definition, ingestionResult } = result;
    console.log(`\nScenario: ${definition.title}`);
    console.log(
      `  Total inserted: ${ingestionResult.totalInserted.toLocaleString()}`
    );
    console.log(
      `  Average throughput: ${Math.round(
        ingestionResult.averageRatePerSecond
      )} logs/sec`
    );
    console.log(
      `  Failed documents: ${ingestionResult.bulkMetrics.failedDocuments.toLocaleString()}`
    );
  });
}

main().catch((error) => {
  console.error("Unexpected error executing scenarios:", error);
  process.exit(1);
});
