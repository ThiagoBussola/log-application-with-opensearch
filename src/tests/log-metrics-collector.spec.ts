import { expect } from "chai";
import { once } from "events";
import { LogMetricsCollector } from "../scripts/transforms/log-metrics-collector";
import { createLogEntry } from "./helpers/log-fixtures";

describe("LogMetricsCollector", () => {
  it("aggregates metric snapshots correctly", async () => {
    const collector = new LogMetricsCollector();

    const logs = [
      createLogEntry({
        level: "info",
        metrics: {
          cpu_usage: 10,
          memory_mb: 512,
          response_time_ms: 200,
          db_query_time_ms: 20,
        },
        tags: ["api", "search-demo"],
      }),
      createLogEntry({
        level: "error",
        metrics: {
          cpu_usage: 70,
          memory_mb: 1024,
          response_time_ms: 600,
          db_query_time_ms: 80,
        },
        error: {
          type: "TimeoutException",
          message: "Connection timeout",
          stack_trace: "stack",
          code: "TO_1001",
        },
      }),
      createLogEntry({
        level: "warn",
        metrics: {
          cpu_usage: 40,
          memory_mb: 768,
          response_time_ms: 400,
          db_query_time_ms: 50,
        },
        service: {
          environment: "staging",
        } as any,
      }),
    ];

    logs.forEach((log) => collector.write(log));
    collector.end();
    await once(collector, "finish");

    const snapshot = collector.getSnapshot();

    expect(snapshot.totalGenerated).to.equal(3);
    expect(snapshot.levelCounts.info).to.equal(1);
    expect(snapshot.levelCounts.error).to.equal(1);
    expect(snapshot.errorCount).to.equal(1);
    expect(snapshot.environmentCounts.production).to.equal(2);
    expect(snapshot.environmentCounts.staging).to.equal(1);
    expect(snapshot.responseTime.avg).to.be.closeTo(400, 0.1);
    expect(snapshot.responseTime.max).to.equal(600);
    expect(snapshot.responseTime.min).to.equal(200);
    expect(snapshot.tagCounts).to.have.property("search-demo");
  });
});
