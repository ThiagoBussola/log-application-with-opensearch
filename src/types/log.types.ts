export interface LogEntry {
  id: string;
  timestamp: string;
  service: {
    name: string;
    version: string;
    environment: "production" | "staging" | "development";
    instance_id: string;
    host: string;
    region: string;
  };
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  category: "application" | "security" | "performance" | "audit" | "system";
  message: string;
  error?: {
    type: string;
    message: string;
    stack_trace: string;
    code: string;
  };
  request?: {
    id: string;
    method: string;
    path: string;
    user_id: string;
    ip: string;
    user_agent: string;
    duration_ms: number;
  };
  business?: {
    transaction_id: string;
    amount: number;
    currency: string;
    payment_method: string;
  };
  metrics: {
    cpu_usage: number;
    memory_mb: number;
    response_time_ms: number;
    db_query_time_ms: number;
  };
  tags: string[];
  geo: {
    country: string;
    city: string;
    location: {
      lat: number;
      lon: number;
    };
  };
}
