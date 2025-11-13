import { LogEntry } from "../../types/log.types";

export function createLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  const base: LogEntry = {
    id: "log-1",
    timestamp: new Date().toISOString(),
    service: {
      name: "api-gateway",
      version: "1.0.0",
      environment: "production",
      instance_id: "i-1234567890",
      host: "ip-127-0-0-1.ec2.internal",
      region: "us-east-1",
    },
    level: "info",
    category: "application",
    message: "Request processed successfully",
    metrics: {
      cpu_usage: 12.5,
      memory_mb: 512,
      response_time_ms: 150,
      db_query_time_ms: 20,
    },
    tags: ["api-gateway"],
    geo: {
      country: "US",
      city: "Seattle",
      location: {
        lat: 47.6062,
        lon: -122.3321,
      },
    },
  };

  return {
    ...base,
    ...overrides,
    service: {
      ...base.service,
      ...(overrides.service ?? {}),
    },
    metrics: {
      ...base.metrics,
      ...(overrides.metrics ?? {}),
    },
    geo: {
      ...base.geo,
      ...(overrides.geo ?? {}),
      location: {
        ...base.geo.location,
        ...(overrides.geo?.location ?? {}),
      },
    },
    request: overrides.request,
    business: overrides.business,
    error: overrides.error,
    tags: overrides.tags ?? base.tags,
  };
}
