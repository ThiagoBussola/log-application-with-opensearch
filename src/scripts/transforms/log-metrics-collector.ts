import { Transform } from "stream";
import { LogEntry } from "../../types/log.types";

export interface LogMetricsSnapshot {
  totalGenerated: number;
  levelCounts: Record<LogEntry["level"], number>;
  serviceCounts: Record<string, number>;
  environmentCounts: Record<LogEntry["service"]["environment"], number>;
  categoryCounts: Record<LogEntry["category"], number>;
  errorCount: number;
  responseTime: {
    min: number;
    max: number;
    avg: number;
    p95: number;
  };
  cpuUsage: {
    min: number;
    max: number;
    avg: number;
  };
  memoryMb: {
    min: number;
    max: number;
    avg: number;
  };
  geoCounts: Record<string, number>;
  tagCounts: Record<string, number>;
}

interface ResponseTimeTracker {
  values: number[];
  min: number;
  max: number;
  total: number;
}

interface NumericTracker {
  min: number;
  max: number;
  total: number;
}

export class LogMetricsCollector extends Transform {
  private total = 0;
  private levelCounts: Record<LogEntry["level"], number> = {
    trace: 0,
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    fatal: 0,
  };
  private serviceCounts: Record<string, number> = {};
  private environmentCounts: Record<
    LogEntry["service"]["environment"],
    number
  > = {
    production: 0,
    staging: 0,
    development: 0,
  };
  private categoryCounts: Record<LogEntry["category"], number> = {
    application: 0,
    security: 0,
    performance: 0,
    audit: 0,
    system: 0,
  };
  private errorCount = 0;
  private responseTime: ResponseTimeTracker = {
    values: [],
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    total: 0,
  };
  private cpuUsage: NumericTracker = {
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    total: 0,
  };
  private memoryMb: NumericTracker = {
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    total: 0,
  };
  private geoCounts: Record<string, number> = {};
  private tagCounts: Record<string, number> = {};

  constructor() {
    super({ objectMode: true });
  }

  _transform(
    chunk: LogEntry,
    _encoding: string,
    callback: (error?: Error | null, data?: LogEntry) => void
  ): void {
    try {
      this.total++;

      this.levelCounts[chunk.level]++;
      this.serviceCounts[chunk.service.name] =
        (this.serviceCounts[chunk.service.name] || 0) + 1;
      this.environmentCounts[chunk.service.environment]++;
      this.categoryCounts[chunk.category]++;

      if (chunk.error) {
        this.errorCount++;
      }

      const responseTime = chunk.metrics.response_time_ms;
      this.responseTime.values.push(responseTime);
      this.responseTime.total += responseTime;
      this.responseTime.min = Math.min(this.responseTime.min, responseTime);
      this.responseTime.max = Math.max(this.responseTime.max, responseTime);

      const cpu = chunk.metrics.cpu_usage;
      this.cpuUsage.total += cpu;
      this.cpuUsage.min = Math.min(this.cpuUsage.min, cpu);
      this.cpuUsage.max = Math.max(this.cpuUsage.max, cpu);

      const memory = chunk.metrics.memory_mb;
      this.memoryMb.total += memory;
      this.memoryMb.min = Math.min(this.memoryMb.min, memory);
      this.memoryMb.max = Math.max(this.memoryMb.max, memory);

      const geoKey = `${chunk.geo.country}|${chunk.geo.city}`;
      this.geoCounts[geoKey] = (this.geoCounts[geoKey] || 0) + 1;

      chunk.tags.forEach((tag) => {
        this.tagCounts[tag] = (this.tagCounts[tag] || 0) + 1;
      });

      this.push(chunk);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  getSnapshot(): LogMetricsSnapshot {
    const avgResponseTime =
      this.total > 0 ? this.responseTime.total / this.total : 0;
    const avgCpu = this.total > 0 ? this.cpuUsage.total / this.total : 0;
    const avgMemory = this.total > 0 ? this.memoryMb.total / this.total : 0;

    const sortedResponseTimes = [...this.responseTime.values].sort(
      (a, b) => a - b
    );
    const p95Index =
      sortedResponseTimes.length === 0
        ? 0
        : Math.floor(sortedResponseTimes.length * 0.95);
    const p95 =
      sortedResponseTimes.length === 0
        ? 0
        : sortedResponseTimes[
            Math.min(p95Index, sortedResponseTimes.length - 1)
          ];

    return {
      totalGenerated: this.total,
      levelCounts: this.levelCounts,
      serviceCounts: this.serviceCounts,
      environmentCounts: this.environmentCounts,
      categoryCounts: this.categoryCounts,
      errorCount: this.errorCount,
      responseTime: {
        min:
          this.responseTime.min === Number.POSITIVE_INFINITY
            ? 0
            : this.responseTime.min,
        max:
          this.responseTime.max === Number.NEGATIVE_INFINITY
            ? 0
            : this.responseTime.max,
        avg: parseFloat(avgResponseTime.toFixed(2)),
        p95,
      },
      cpuUsage: {
        min:
          this.cpuUsage.min === Number.POSITIVE_INFINITY
            ? 0
            : parseFloat(this.cpuUsage.min.toFixed(2)),
        max:
          this.cpuUsage.max === Number.NEGATIVE_INFINITY
            ? 0
            : parseFloat(this.cpuUsage.max.toFixed(2)),
        avg: parseFloat(avgCpu.toFixed(2)),
      },
      memoryMb: {
        min:
          this.memoryMb.min === Number.POSITIVE_INFINITY
            ? 0
            : this.memoryMb.min,
        max:
          this.memoryMb.max === Number.NEGATIVE_INFINITY
            ? 0
            : this.memoryMb.max,
        avg: parseFloat(avgMemory.toFixed(2)),
      },
      geoCounts: this.geoCounts,
      tagCounts: this.tagCounts,
    };
  }
}
