import { faker } from "@faker-js/faker";
import { LogEntry } from "../../types/log.types";

const SERVICES = [
  { name: "api-gateway", weight: 25 },
  { name: "auth-service", weight: 15 },
  { name: "payment-service", weight: 10 },
  { name: "user-service", weight: 12 },
  { name: "notification-service", weight: 8 },
  { name: "order-service", weight: 10 },
  { name: "inventory-service", weight: 8 },
  { name: "analytics-service", weight: 7 },
  { name: "search-service", weight: 5 },
];

const LOG_LEVELS = [
  { level: "trace", weight: 5 },
  { level: "debug", weight: 15 },
  { level: "info", weight: 60 },
  { level: "warn", weight: 15 },
  { level: "error", weight: 4 },
  { level: "fatal", weight: 1 },
] as const;

const ENVIRONMENTS = [
  { env: "production", weight: 70 },
  { env: "staging", weight: 20 },
  { env: "development", weight: 10 },
] as const;

const CATEGORIES = [
  "application",
  "security",
  "performance",
  "audit",
  "system",
] as const;

const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"];

const ERROR_TYPES = [
  "TimeoutException",
  "DatabaseException",
  "ValidationException",
  "AuthenticationException",
  "PaymentGatewayException",
  "NetworkException",
  "ServiceUnavailableException",
];

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

const PAYMENT_METHODS = [
  "credit_card",
  "debit_card",
  "paypal",
  "bank_transfer",
];

const CURRENCIES = ["USD", "EUR", "GBP", "BRL", "INR"];

function weightedRandom<T>(
  items: readonly { weight: number; [key: string]: any }[]
): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= item.weight;
    if (random <= 0) {
      return item as T;
    }
  }

  return items[0] as T;
}

function generateTimestamp(baseDate: Date): string {
  const hour = Math.floor(Math.random() * 24);

  let hourToUse = hour;
  if (Math.random() < 0.6) {
    hourToUse = 10 + Math.floor(Math.random() * 8);
  }

  const date = new Date(baseDate);
  date.setUTCHours(hourToUse);
  date.setUTCMinutes(Math.floor(Math.random() * 60));
  date.setUTCSeconds(Math.floor(Math.random() * 60));
  date.setUTCMilliseconds(Math.floor(Math.random() * 1000));

  return date.toISOString();
}

export function generateLog(baseDate: Date = new Date()): LogEntry {
  const service = weightedRandom<{ name: string }>(SERVICES);
  const level = weightedRandom<{ level: LogEntry["level"] }>(LOG_LEVELS).level;
  const environment = weightedRandom<{
    env: LogEntry["service"]["environment"];
  }>(ENVIRONMENTS).env;

  const hasError = level === "error" || level === "fatal";
  const isPaymentService = service.name === "payment-service";

  const log: LogEntry = {
    id: faker.string.uuid(),
    timestamp: generateTimestamp(baseDate),
    service: {
      name: service.name,
      version: `${faker.number.int({ min: 1, max: 3 })}.${faker.number.int({
        min: 0,
        max: 9,
      })}.${faker.number.int({ min: 0, max: 20 })}`,
      environment,
      instance_id: `i-${faker.string.alphanumeric(10)}`,
      host: `ip-${faker.number.int({ min: 10, max: 172 })}-${faker.number.int({
        min: 0,
        max: 255,
      })}-${faker.number.int({ min: 0, max: 255 })}-${faker.number.int({
        min: 0,
        max: 255,
      })}.ec2.internal`,
      region: faker.helpers.arrayElement(REGIONS),
    },
    level,
    category: faker.helpers.arrayElement(CATEGORIES),
    message: generateMessage(service.name, level),
    metrics: {
      cpu_usage: parseFloat((Math.random() * 100).toFixed(2)),
      memory_mb: faker.number.int({ min: 128, max: 2048 }),
      response_time_ms: faker.number.int({ min: 10, max: 5000 }),
      db_query_time_ms: faker.number.int({ min: 5, max: 500 }),
    },
    tags: generateTags(service.name, level),
    geo: {
      country: faker.location.countryCode(),
      city: faker.location.city(),
      location: {
        lat: faker.location.latitude(),
        lon: faker.location.longitude(),
      },
    },
  };

  if (hasError) {
    const errorType = faker.helpers.arrayElement(ERROR_TYPES);
    log.error = {
      type: errorType,
      message: generateErrorMessage(errorType),
      stack_trace: generateStackTrace(service.name, errorType),
      code: `${errorType.substring(0, 2).toUpperCase()}_${faker.number.int({
        min: 1000,
        max: 9999,
      })}`,
    };
  }

  if (Math.random() < 0.8) {
    log.request = {
      id: `req-${faker.string.alphanumeric(10)}`,
      method: faker.helpers.arrayElement(HTTP_METHODS),
      path: generateApiPath(service.name),
      user_id: `user-${faker.string.alphanumeric(8)}`,
      ip: faker.internet.ipv4(),
      user_agent: faker.internet.userAgent(),
      duration_ms: faker.number.int({ min: 50, max: 10000 }),
    };
  }

  if (isPaymentService && Math.random() < 0.7) {
    log.business = {
      transaction_id: `txn-${faker.string.alphanumeric(12)}`,
      amount: parseFloat((Math.random() * 1000).toFixed(2)),
      currency: faker.helpers.arrayElement(CURRENCIES),
      payment_method: faker.helpers.arrayElement(PAYMENT_METHODS),
    };
  }

  return log;
}

function generateMessage(serviceName: string, level: string): string {
  const messages = {
    trace: [
      `Entering method processRequest in ${serviceName}`,
      `Executing query on database`,
      `Cache lookup for key`,
    ],
    debug: [
      `Processing request with parameters`,
      `Database query executed successfully`,
      `Cache hit for key`,
    ],
    info: [
      `Request processed successfully`,
      `User authenticated successfully`,
      `Data synchronized with external service`,
      `Batch job completed`,
    ],
    warn: [
      `High memory usage detected`,
      `Slow query detected`,
      `Deprecated API endpoint used`,
      `Rate limit approaching threshold`,
    ],
    error: [
      `Failed to process payment`,
      `Database connection timeout`,
      `External service unavailable`,
      `Validation failed for user input`,
    ],
    fatal: [
      `Critical system failure`,
      `Database corruption detected`,
      `Out of memory error`,
      `Unrecoverable error in core service`,
    ],
  };

  return faker.helpers.arrayElement(messages[level as keyof typeof messages]);
}

function generateErrorMessage(errorType: string): string {
  const messages: Record<string, string[]> = {
    TimeoutException: ["Connection timeout", "Request timeout after 30s"],
    DatabaseException: ["Query execution failed", "Connection pool exhausted"],
    ValidationException: ["Invalid input data", "Missing required field"],
    AuthenticationException: ["Invalid credentials", "Token expired"],
    PaymentGatewayException: ["Payment provider timeout", "Insufficient funds"],
    NetworkException: ["Network unreachable", "Connection refused"],
    ServiceUnavailableException: [
      "Service temporarily unavailable",
      "Circuit breaker open",
    ],
  };

  return faker.helpers.arrayElement(messages[errorType] || ["Unknown error"]);
}

function generateStackTrace(serviceName: string, errorType: string): string {
  return `${errorType}: Error in ${serviceName}
    at com.example.${serviceName}.Controller.handleRequest(Controller.java:${faker.number.int(
    { min: 10, max: 500 }
  )})
    at com.example.${serviceName}.Service.process(Service.java:${faker.number.int(
    { min: 10, max: 500 }
  )})
    at com.example.common.Handler.execute(Handler.java:${faker.number.int({
      min: 10,
      max: 500,
    })})`;
}

function generateApiPath(serviceName: string): string {
  const paths: Record<string, string[]> = {
    "api-gateway": ["/api/v1/health", "/api/v1/users", "/api/v1/orders"],
    "auth-service": ["/auth/login", "/auth/logout", "/auth/refresh"],
    "payment-service": [
      "/payments/process",
      "/payments/refund",
      "/payments/status",
    ],
    "user-service": ["/users/profile", "/users/settings", "/users/delete"],
    "order-service": ["/orders/create", "/orders/update", "/orders/cancel"],
  };

  const servicePaths = paths[serviceName] || ["/api/v1/generic"];
  return faker.helpers.arrayElement(servicePaths);
}

function generateTags(serviceName: string, level: string): string[] {
  const baseTags = [serviceName];

  if (level === "error" || level === "fatal") {
    baseTags.push("critical");
  }

  if (Math.random() < 0.3) {
    baseTags.push(
      faker.helpers.arrayElement(["monitoring", "alert", "performance"])
    );
  }

  return baseTags;
}
