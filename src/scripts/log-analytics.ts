import { opensearchClient, testConnection } from "../config/opensearch.config";
import chalk from "chalk";
// @ts-ignore - asciichart doesn't have proper TypeScript definitions
import * as asciichart from "asciichart";
import {
  OpenSearchSearchResponse,
  TermsAggregation,
  DateHistogramAggregation,
  StatsAggregation,
} from "../types/opensearch.types";

interface AggregationBucket {
  key: string;
  count: number;
}

interface TimeSeriesBucket {
  timestamp: string;
  count: number;
}

interface LogAnalytics {
  totalLogs: number;
  byLevel: AggregationBucket[];
  byService: AggregationBucket[];
  byCategory: AggregationBucket[];
  criticalLogs: {
    error: number;
    fatal: number;
    total: number;
  };
  topErrorServices: AggregationBucket[];
  performanceMetrics: {
    avgResponseTime: number;
    maxResponseTime: number;
    avgCpuUsage: number;
    avgMemoryUsage: number;
  };
  geographicDistribution: AggregationBucket[];
  timeSeries: TimeSeriesBucket[];
}

async function getAllIndices(): Promise<string[]> {
  try {
    const response = await opensearchClient.cat.indices({
      format: "json",
      index: "logs-*",
    });
    return (response.body as any[])
      .map((idx: any) => idx.index)
      .filter((idx: string) => idx.startsWith("logs-"));
  } catch (error) {
    console.error("Error fetching indices:", error);
    return [];
  }
}

async function fetchAnalytics(
  indexPattern: string = "logs-*",
  days: number = 1
): Promise<LogAnalytics> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    const response = await opensearchClient.search({
      index: indexPattern,
      body: {
        query: {
          range: {
            timestamp: {
              gte: startDate.toISOString(),
              lte: endDate.toISOString(),
            },
          },
        },
        size: 0,
        aggs: {
          by_level: {
            terms: {
              field: "level",
              size: 10,
            },
          },
          by_service: {
            terms: {
              field: "service.name",
              size: 20,
            },
          },
          by_category: {
            terms: {
              field: "category",
              size: 10,
            },
          },
          critical_logs: {
            terms: {
              field: "level",
              include: ["error", "fatal"],
            },
          },
          top_error_services: {
            filter: {
              terms: {
                level: ["error", "fatal"],
              },
            },
            aggs: {
              services: {
                terms: {
                  field: "service.name",
                  size: 10,
                },
              },
            },
          },
          performance_metrics: {
            stats: {
              field: "metrics.response_time_ms",
            },
          },
          avg_cpu: {
            avg: {
              field: "metrics.cpu_usage",
            },
          },
          avg_memory: {
            avg: {
              field: "metrics.memory_mb",
            },
          },
          geographic: {
            terms: {
              field: "geo.country",
              size: 10,
            },
          },
          time_series: {
            date_histogram: {
              field: "timestamp",
              fixed_interval: days === 1 ? "1h" : days <= 7 ? "1d" : "1d",
              min_doc_count: 0,
            },
          },
        },
      },
    });

    const body = response.body as OpenSearchSearchResponse;
    const aggs = body.aggregations;
    const hits = body.hits;

    if (!aggs) {
      return {
        totalLogs:
          typeof hits.total === "number" ? hits.total : hits.total.value,
        byLevel: [],
        byService: [],
        byCategory: [],
        criticalLogs: { error: 0, fatal: 0, total: 0 },
        topErrorServices: [],
        performanceMetrics: {
          avgResponseTime: 0,
          maxResponseTime: 0,
          avgCpuUsage: 0,
          avgMemoryUsage: 0,
        },
        geographicDistribution: [],
        timeSeries: [],
      };
    }

    const criticalLogs = aggs.critical_logs as TermsAggregation | undefined;
    const errorCount =
      criticalLogs?.buckets?.find((b) => b.key === "error")?.doc_count || 0;
    const fatalCount =
      criticalLogs?.buckets?.find((b) => b.key === "fatal")?.doc_count || 0;

    const topErrorServices = aggs.top_error_services as
      | {
          services?: TermsAggregation;
        }
      | undefined;
    const performanceMetrics = aggs.performance_metrics as
      | StatsAggregation
      | undefined;
    const avgCpu = aggs.avg_cpu as { value: number } | undefined;
    const avgMemory = aggs.avg_memory as { value: number } | undefined;

    const byLevel =
      (aggs.by_level as TermsAggregation | undefined)?.buckets || [];
    const byService =
      (aggs.by_service as TermsAggregation | undefined)?.buckets || [];
    const byCategory =
      (aggs.by_category as TermsAggregation | undefined)?.buckets || [];
    const geographic =
      (aggs.geographic as TermsAggregation | undefined)?.buckets || [];
    const timeSeries =
      (aggs.time_series as DateHistogramAggregation | undefined)?.buckets || [];

    return {
      totalLogs: typeof hits.total === "number" ? hits.total : hits.total.value,
      byLevel: byLevel.map((b) => ({
        key: String(b.key),
        count: b.doc_count,
      })),
      byService: byService.map((b) => ({
        key: String(b.key),
        count: b.doc_count,
      })),
      byCategory: byCategory.map((b) => ({
        key: String(b.key),
        count: b.doc_count,
      })),
      criticalLogs: {
        error: errorCount,
        fatal: fatalCount,
        total: errorCount + fatalCount,
      },
      topErrorServices: (topErrorServices?.services?.buckets || []).map(
        (b) => ({
          key: String(b.key),
          count: b.doc_count,
        })
      ),
      performanceMetrics: {
        avgResponseTime: performanceMetrics?.avg || 0,
        maxResponseTime: performanceMetrics?.max || 0,
        avgCpuUsage: avgCpu?.value || 0,
        avgMemoryUsage: avgMemory?.value || 0,
      },
      geographicDistribution: geographic.map((b) => ({
        key: String(b.key),
        count: b.doc_count,
      })),
      timeSeries: timeSeries.map((b) => ({
        timestamp: new Date(Number(b.key)).toISOString(),
        count: b.doc_count,
      })),
    };
  } catch (error) {
    console.error("Error fetching analytics:", error);
    throw error;
  }
}

function printHeader(title: string) {
  console.log("\n" + chalk.bold.cyan("=".repeat(60)));
  console.log(chalk.bold.cyan(title));
  console.log(chalk.bold.cyan("=".repeat(60)));
}

function printBarChart(
  data: AggregationBucket[],
  title: string,
  maxWidth: number = 50
) {
  if (data.length === 0) {
    console.log(chalk.yellow("  No data available"));
    return;
  }

  const maxCount = Math.max(...data.map((d) => d.count));
  const maxLabelLength = Math.max(...data.map((d) => d.key.length));

  // Array de cores para alternar
  const barColors = [
    chalk.green,
    chalk.blue,
    chalk.cyan,
    chalk.magenta,
    chalk.yellow,
    chalk.red,
    chalk.white,
  ];

  data.forEach((item, index) => {
    const barLength = Math.round((item.count / maxCount) * maxWidth);
    const bar = "█".repeat(barLength);
    const percentage = ((item.count / maxCount) * 100).toFixed(1);
    const label = item.key.padEnd(maxLabelLength);
    const colorFn = barColors[index % barColors.length];

    console.log(
      `  ${chalk.white(label)} │${colorFn(bar)} ${chalk.yellow(
        item.count.toLocaleString()
      )} (${percentage}%)`
    );
  });
}

function printPieChart(data: AggregationBucket[], title: string) {
  if (data.length === 0) {
    console.log(chalk.yellow("  No data available"));
    return;
  }

  const total = data.reduce((sum, item) => sum + item.count, 0);
  // Cores mais vibrantes e distintas para o gráfico de pizza
  const colors = [
    chalk.red,
    chalk.blue,
    chalk.green,
    chalk.yellow,
    chalk.magenta,
    chalk.cyan,
    chalk.white,
    chalk.gray,
  ];

  data.forEach((item, index) => {
    const percentage = ((item.count / total) * 100).toFixed(1);
    const color = colors[index % colors.length];
    const barLength = Math.round((item.count / total) * 20);
    const bar = "█".repeat(barLength);
    console.log(
      `  ${color(bar.padEnd(20))} ${chalk.white(item.key)}: ${chalk.yellow(
        percentage + "%"
      )} (${item.count.toLocaleString()})`
    );
  });
}

function printTimeSeriesChart(data: TimeSeriesBucket[], title: string) {
  if (data.length === 0) {
    console.log(chalk.yellow("  No data available"));
    return;
  }

  const values = data.map((d) => d.count);
  // @ts-ignore - asciichart types are not properly defined
  const chart = asciichart.plot(values, {
    height: 10,
    // @ts-ignore
    colors: [asciichart.blue],
  });
  console.log(chart);

  // Show min/max points
  const maxIndex = values.indexOf(Math.max(...values));
  const minIndex = values.indexOf(Math.min(...values));
  console.log(
    chalk.green(
      `  Peak: ${data[maxIndex].count} logs at ${new Date(
        data[maxIndex].timestamp
      ).toLocaleString()}`
    )
  );
  console.log(
    chalk.red(
      `  Low: ${data[minIndex].count} logs at ${new Date(
        data[minIndex].timestamp
      ).toLocaleString()}`
    )
  );
}

function printMetrics(analytics: LogAnalytics) {
  printHeader("LOG ANALYTICS DASHBOARD");

  // Total Logs
  console.log("\n" + chalk.bold("Total Logs:"));
  console.log(
    `  ${chalk.cyan(analytics.totalLogs.toLocaleString())} logs analyzed`
  );

  // Critical Logs
  console.log("\n" + chalk.bold.red("Critical Logs:"));
  console.log(
    `  ${chalk.red("Error:")} ${analytics.criticalLogs.error.toLocaleString()}`
  );
  console.log(
    `  ${chalk.red("Fatal:")} ${analytics.criticalLogs.fatal.toLocaleString()}`
  );
  console.log(
    `  ${chalk.bold("Total:")} ${analytics.criticalLogs.total.toLocaleString()}`
  );

  // Performance Metrics
  console.log("\n" + chalk.bold("⚡ Performance Metrics:"));
  console.log(
    `  Avg Response Time: ${chalk.yellow(
      analytics.performanceMetrics.avgResponseTime.toFixed(2)
    )} ms`
  );
  console.log(
    `  Max Response Time: ${chalk.red(
      analytics.performanceMetrics.maxResponseTime.toFixed(2)
    )} ms`
  );
  console.log(
    `  Avg CPU Usage: ${chalk.yellow(
      analytics.performanceMetrics.avgCpuUsage.toFixed(2)
    )}%`
  );
  console.log(
    `  Avg Memory Usage: ${chalk.yellow(
      analytics.performanceMetrics.avgMemoryUsage.toFixed(2)
    )} MB`
  );

  // Distribution by Level
  printHeader("Distribution by Log Level");
  printPieChart(analytics.byLevel, "Log Levels");

  // Distribution by Service
  printHeader("Distribution by Service");
  printBarChart(analytics.byService, "Services");

  // Distribution by Category
  printHeader("Distribution by Category");
  printBarChart(analytics.byCategory, "Categories");

  // Top Error Services
  printHeader("Top Services with Errors");
  if (analytics.topErrorServices.length > 0) {
    printBarChart(analytics.topErrorServices, "Error Services");
  } else {
    console.log(chalk.green("No errors found!"));
  }

  // Geographic Distribution
  printHeader("Geographic Distribution");
  printBarChart(analytics.geographicDistribution, "Countries");

  // Time Series
  printHeader("Time Series (Logs Over Time)");
  printTimeSeriesChart(analytics.timeSeries, "Time Series");
}

async function main() {
  const args = process.argv.slice(2);
  const days = parseInt(args[0]) || 1;
  const indexPattern = args[1] || "logs-*";

  console.log(chalk.bold.blue("\nConnecting to OpenSearch..."));
  const connected = await testConnection();
  if (!connected) {
    console.error(chalk.red("Cannot connect to OpenSearch"));
    process.exit(1);
  }

  console.log(chalk.green("Connected to OpenSearch"));
  console.log(
    chalk.blue(
      `Fetching analytics for last ${days} day(s) from ${indexPattern}...`
    )
  );

  try {
    const analytics = await fetchAnalytics(indexPattern, days);
    printMetrics(analytics);
  } catch (error) {
    console.error(chalk.red("Error fetching analytics:"), error);
    process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red("Fatal error:"), error);
    process.exit(1);
  });
}
