import { opensearchClient, testConnection } from "../config/opensearch.config";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import {
  OpenSearchSearchResponse,
  TermsAggregation,
  DateHistogramAggregation,
} from "../types/opensearch.types";

interface AggregationBucket {
  key: string;
  count: number;
}

interface TimeSeriesBucket {
  timestamp: string;
  count: number;
}

const width = 1200;
const height = 800;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

async function fetchAnalyticsData(
  indexPattern: string = "logs-*",
  days: number = 1
) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

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
      totalLogs: typeof hits.total === "number" ? hits.total : hits.total.value,
      byLevel: [],
      byService: [],
      byCategory: [],
      topErrorServices: [],
      geographicDistribution: [],
      timeSeries: [],
    };
  }

  const byLevel =
    (aggs.by_level as TermsAggregation | undefined)?.buckets || [];
  const byService =
    (aggs.by_service as TermsAggregation | undefined)?.buckets || [];
  const byCategory =
    (aggs.by_category as TermsAggregation | undefined)?.buckets || [];
  const topErrorServices =
    (
      aggs.top_error_services as
        | {
            services?: TermsAggregation;
          }
        | undefined
    )?.services?.buckets || [];
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
    topErrorServices: topErrorServices.map((b) => ({
      key: String(b.key),
      count: b.doc_count,
    })),
    geographicDistribution: geographic.map((b) => ({
      key: String(b.key),
      count: b.doc_count,
    })),
    timeSeries: timeSeries.map((b) => ({
      timestamp: new Date(Number(b.key)).toISOString(),
      count: b.doc_count,
    })),
  };
}

async function generatePieChart(
  data: AggregationBucket[],
  title: string,
  outputPath: string
) {
  const config = {
    type: "pie" as const,
    data: {
      labels: data.map((d) => d.key),
      datasets: [
        {
          data: data.map((d) => d.count),
          backgroundColor: [
            "#FF6384",
            "#36A2EB",
            "#FFCE56",
            "#4BC0C0",
            "#9966FF",
            "#FF9F40",
            "#FF6384",
            "#C9CBCF",
          ],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: {
            size: 20,
          },
        },
        legend: {
          position: "right" as const,
        },
      },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(config);
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(chalk.green(`Generated: ${outputPath}`));
}

async function generateBarChart(
  data: AggregationBucket[],
  title: string,
  outputPath: string,
  horizontal: boolean = false
) {
  const config = {
    type: "bar" as const,
    data: {
      labels: data.map((d) => d.key),
      datasets: [
        {
          label: "Count",
          data: data.map((d) => d.count),
          backgroundColor: "#36A2EB",
          borderColor: "#1E88E5",
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: horizontal ? ("y" as const) : ("x" as const),
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: {
            size: 20,
          },
        },
        legend: {
          display: false,
        },
      },
      scales: horizontal
        ? {
            x: {
              beginAtZero: true,
            },
          }
        : {
            y: {
              beginAtZero: true,
            },
          },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(config);
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(chalk.green(`Generated: ${outputPath}`));
}

async function generateLineChart(
  data: TimeSeriesBucket[],
  title: string,
  outputPath: string
) {
  const labels = data.map((d) => {
    const date = new Date(d.timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
    });
  });

  const config = {
    type: "line" as const,
    data: {
      labels,
      datasets: [
        {
          label: "Logs",
          data: data.map((d) => d.count),
          borderColor: "#36A2EB",
          backgroundColor: "rgba(54, 162, 235, 0.1)",
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: {
            size: 20,
          },
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(config);
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(chalk.green(`Generated: ${outputPath}`));
}

async function generateHeatmap(
  data: AggregationBucket[],
  title: string,
  outputPath: string
) {
  // Create a simple bar chart as heatmap representation
  const maxValue = Math.max(...data.map((d) => d.count));
  const normalizedData = data.map((d) => (d.count / maxValue) * 100);

  const config = {
    type: "bar" as const,
    data: {
      labels: data.map((d) => d.key),
      datasets: [
        {
          label: "Logs",
          data: normalizedData,
          backgroundColor: normalizedData.map((val) => {
            if (val > 80) return "#FF0000";
            if (val > 60) return "#FF6600";
            if (val > 40) return "#FFCC00";
            if (val > 20) return "#99FF00";
            return "#00FF00";
          }),
          borderColor: "#000000",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: {
            size: 20,
          },
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function (value: any) {
              return value + "%";
            },
          },
        },
      },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(config);
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(chalk.green(`Generated: ${outputPath}`));
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
    const analytics = await fetchAnalyticsData(indexPattern, days);

    // Create charts directory
    const chartsDir = path.join(process.cwd(), "logs", "charts");
    if (!fs.existsSync(chartsDir)) {
      fs.mkdirSync(chartsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basePath = path.join(chartsDir, timestamp);

    console.log(chalk.bold.cyan("\nGenerating charts..."));

    // Generate all charts
    if (analytics.byLevel.length > 0) {
      await generatePieChart(
        analytics.byLevel,
        "Distribution by Log Level",
        `${basePath}-level-distribution.png`
      );
    }

    if (analytics.byService.length > 0) {
      await generateBarChart(
        analytics.byService,
        "Logs by Service",
        `${basePath}-service-distribution.png`
      );
    }

    if (analytics.byCategory.length > 0) {
      await generateBarChart(
        analytics.byCategory,
        "Logs by Category",
        `${basePath}-category-distribution.png`
      );
    }

    if (analytics.topErrorServices.length > 0) {
      await generateBarChart(
        analytics.topErrorServices,
        "Top Services with Errors",
        `${basePath}-top-errors.png`,
        true
      );
    }

    if (analytics.geographicDistribution.length > 0) {
      await generateHeatmap(
        analytics.geographicDistribution,
        "Geographic Distribution",
        `${basePath}-geographic-heatmap.png`
      );
    }

    if (analytics.timeSeries.length > 0) {
      await generateLineChart(
        analytics.timeSeries,
        "Time Series - Logs Over Time",
        `${basePath}-time-series.png`
      );
    }

    console.log(chalk.bold.green("\nAll charts generated successfully!"));
    console.log(chalk.cyan(`Charts saved to: ${chartsDir}`));
  } catch (error) {
    console.error(chalk.red("Error generating charts:"), error);
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
