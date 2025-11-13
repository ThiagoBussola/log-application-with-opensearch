export const LOG_INDEX_TEMPLATE = {
  index_patterns: ["logs-*"],
  template: {
    settings: {
      number_of_shards: 10,
      number_of_replicas: 1,
      refresh_interval: "30s",
      codec: "best_compression",
      "index.max_result_window": 10000,
      "index.translog.durability": "async",
      "index.translog.sync_interval": "30s",
      analysis: {
        analyzer: {
          log_message_analyzer: {
            type: "custom",
            tokenizer: "standard",
            filter: ["lowercase", "stop", "snowball"],
          },
        },
      },
    },
    mappings: {
      properties: {
        id: { type: "keyword" },
        timestamp: {
          type: "date",
          format: "strict_date_optional_time||epoch_millis",
        },
        service: {
          properties: {
            name: { type: "keyword" },
            version: { type: "keyword" },
            environment: { type: "keyword" },
            instance_id: { type: "keyword" },
            host: { type: "keyword" },
            region: { type: "keyword" },
          },
        },
        level: { type: "keyword" },
        category: { type: "keyword" },
        message: {
          type: "text",
          analyzer: "log_message_analyzer",
          fields: {
            keyword: {
              type: "keyword",
              ignore_above: 256,
            },
          },
        },
        error: {
          properties: {
            type: { type: "keyword" },
            message: {
              type: "text",
              analyzer: "log_message_analyzer",
            },
            stack_trace: {
              type: "text",
              index: false,
            },
            code: { type: "keyword" },
          },
        },
        request: {
          properties: {
            id: { type: "keyword" },
            method: { type: "keyword" },
            path: { type: "keyword" },
            user_id: { type: "keyword" },
            ip: { type: "ip" },
            user_agent: {
              type: "text",
              fields: {
                keyword: { type: "keyword", ignore_above: 256 },
              },
            },
            duration_ms: { type: "integer" },
          },
        },
        business: {
          properties: {
            transaction_id: { type: "keyword" },
            amount: { type: "scaled_float", scaling_factor: 100 },
            currency: { type: "keyword" },
            payment_method: { type: "keyword" },
          },
        },
        metrics: {
          properties: {
            cpu_usage: { type: "float" },
            memory_mb: { type: "integer" },
            response_time_ms: { type: "integer" },
            db_query_time_ms: { type: "integer" },
          },
        },
        tags: { type: "keyword" },
        geo: {
          properties: {
            country: { type: "keyword" },
            city: { type: "keyword" },
            location: { type: "geo_point" },
          },
        },
      },
    },
  },
};
