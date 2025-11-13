export const logTypeDefs = `#graphql
  type Service {
    name: String!
    version: String!
    environment: String!
    instance_id: String!
    host: String!
    region: String!
  }

  type Error {
    type: String!
    message: String!
    stack_trace: String!
    code: String!
  }

  type Request {
    id: String!
    method: String!
    path: String!
    user_id: String!
    ip: String!
    user_agent: String!
    duration_ms: Int!
  }

  type Business {
    transaction_id: String!
    amount: Float!
    currency: String!
    payment_method: String!
  }

  type Metrics {
    cpu_usage: Float!
    memory_mb: Int!
    response_time_ms: Int!
    db_query_time_ms: Int!
  }

  type GeoLocation {
    lat: Float!
    lon: Float!
  }

  type Geo {
    country: String!
    city: String!
    location: GeoLocation!
  }

  type Log {
    id: ID!
    timestamp: String!
    service: Service!
    level: String!
    category: String!
    message: String!
    error: Error
    request: Request
    business: Business
    metrics: Metrics!
    tags: [String!]!
    geo: Geo!
  }

  type LogConnection {
    logs: [Log!]!
    total: Int!
    pageInfo: PageInfo!
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  type AggregationBucket {
    key: String!
    count: Int!
  }

  type LogLevelAggregation {
    buckets: [AggregationBucket!]!
  }

  type ServiceAggregation {
    buckets: [AggregationBucket!]!
  }

  type TimeSeriesBucket {
    timestamp: String!
    count: Int!
  }

  type LogAggregations {
    byLevel: LogLevelAggregation!
    byService: ServiceAggregation!
    timeSeries: [TimeSeriesBucket!]!
    totalLogs: Int!
  }

  type SimilarLog {
    log: Log!
    score: Float!
  }

  input LogFilters {
    levels: [String!]
    services: [String!]
    environments: [String!]
    categories: [String!]
    startDate: String
    endDate: String
    searchText: String
    minResponseTime: Int
    maxResponseTime: Int
    hasError: Boolean
  }

  input TimeSeriesInterval {
    interval: String! # "1h", "1d", "1w", etc.
  }

  type Query {
    # Busca de logs com filtros e paginação
    logs(
      filters: LogFilters
      limit: Int = 20
      offset: Int = 0
    ): LogConnection!

    # Buscar log por ID
    log(id: ID!): Log

    # Agregações e estatísticas
    logAggregations(
      filters: LogFilters
      timeSeriesInterval: TimeSeriesInterval
    ): LogAggregations!

    # Busca por similaridade (usando k-NN ou More Like This)
    similarLogs(
      logId: ID!
      limit: Int = 10
    ): [SimilarLog!]!

    # Busca textual avançada
    searchLogs(
      query: String!
      filters: LogFilters
      limit: Int = 20
      offset: Int = 0
    ): LogConnection!
  }
`;
