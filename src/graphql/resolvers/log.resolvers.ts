import { opensearchClient } from "../../config/opensearch.config";

function getTotalHits(
  total: number | { value: number; relation: string } | undefined
): number {
  if (!total) return 0;
  return typeof total === "number" ? total : total.value;
}

async function ensureIndexExists(indexName: string): Promise<void> {
  try {
    const exists = await opensearchClient.indices.exists({ index: indexName });
    if (!exists.body) {
      await opensearchClient.indices.create({ index: indexName });
    }
  } catch (error: any) {
    if (
      error.meta?.statusCode === 404 ||
      error.meta?.body?.error?.type === "index_not_found_exception"
    ) {
      try {
        await opensearchClient.indices.create({ index: indexName });
      } catch (createError: any) {
        if (
          createError.meta?.body?.error?.type !==
          "resource_already_exists_exception"
        ) {
          throw createError;
        }
      }
    }
  }
}

interface LogFilters {
  levels?: string[];
  services?: string[];
  environments?: string[];
  categories?: string[];
  startDate?: string;
  endDate?: string;
  searchText?: string;
  minResponseTime?: number;
  maxResponseTime?: number;
  hasError?: boolean;
}

interface LogsArgs {
  filters?: LogFilters;
  limit?: number;
  offset?: number;
}

interface SearchLogsArgs extends LogsArgs {
  query: string;
}

interface LogAggregationsArgs {
  filters?: LogFilters;
  timeSeriesInterval?: {
    interval: string;
  };
}

interface SimilarLogsArgs {
  logId: string;
  limit?: number;
}

// Helper para construir query do OpenSearch
function buildQuery(filters?: LogFilters): any {
  const must: any[] = [];
  const filter: any[] = [];
  const mustNot: any[] = [];

  // Filtro de data
  if (filters?.startDate || filters?.endDate) {
    const range: Record<string, string | number> = {};
    if (filters.startDate) range.gte = filters.startDate;
    if (filters.endDate) range.lte = filters.endDate;
    filter.push({ range: { timestamp: range } });
  }

  // Filtros de termos exatos
  if (filters?.levels?.length) {
    filter.push({ terms: { level: filters.levels } });
  }

  if (filters?.services?.length) {
    filter.push({ terms: { "service.name": filters.services } });
  }

  if (filters?.environments?.length) {
    filter.push({ terms: { "service.environment": filters.environments } });
  }

  if (filters?.categories?.length) {
    filter.push({ terms: { category: filters.categories } });
  }

  // Filtro de response time
  if (filters?.minResponseTime || filters?.maxResponseTime) {
    const range: Record<string, number> = {};
    if (filters.minResponseTime) range.gte = filters.minResponseTime;
    if (filters.maxResponseTime) range.lte = filters.maxResponseTime;
    filter.push({ range: { "metrics.response_time_ms": range } });
  }

  // Filtro de erro
  if (filters?.hasError !== undefined) {
    if (filters.hasError) {
      filter.push({ exists: { field: "error" } });
    } else {
      mustNot.push({ exists: { field: "error" } });
    }
  }

  // Busca textual
  if (filters?.searchText) {
    must.push({
      multi_match: {
        query: filters.searchText,
        fields: ["message", "error.message", "request.path"],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    });
  }

  const boolQuery: Record<string, unknown> = {};
  if (must.length > 0) boolQuery.must = must;
  if (filter.length > 0) boolQuery.filter = filter;
  if (mustNot.length > 0) boolQuery.must_not = mustNot;

  if (Object.keys(boolQuery).length === 0) {
    return { match_all: {} };
  }

  return { bool: boolQuery };
}

export const logResolvers = {
  Query: {
    // Buscar logs com filtros
    logs: async (_: any, args: LogsArgs) => {
      const { filters, limit = 20, offset = 0 } = args;

      // Buscar no índice de hoje (pode expandir para múltiplos índices)
      const today = new Date().toISOString().split("T")[0];
      const indexName = `logs-${today}`;

      try {
        await ensureIndexExists(indexName);

        const response = await opensearchClient.search({
          index: indexName,
          body: {
            query: buildQuery(filters),
            from: offset,
            size: limit,
            sort: [{ timestamp: { order: "desc" } }],
          },
        });

        const logs = response.body.hits.hits.map((hit: any) => ({
          id: hit._id,
          ...hit._source,
        }));

        const total = getTotalHits(response.body.hits.total);

        return {
          logs,
          total,
          pageInfo: {
            hasNextPage: offset + limit < total,
            hasPreviousPage: offset > 0,
          },
        };
      } catch (error) {
        console.error("Error fetching logs:", error);
        throw new Error("Failed to fetch logs");
      }
    },

    // Buscar log específico por ID
    log: async (_: any, { id }: { id: string }) => {
      const today = new Date().toISOString().split("T")[0];
      const indexName = `logs-${today}`;

      try {
        await ensureIndexExists(indexName);

        const response = await opensearchClient.get({
          index: indexName,
          id,
        });

        return {
          id: response.body._id,
          ...response.body._source,
        };
      } catch (error: any) {
        if (error.meta?.body?.found === false) {
          return null;
        }
        console.error("Error fetching log:", error);
        throw new Error("Failed to fetch log");
      }
    },

    // Agregações
    logAggregations: async (_: any, args: LogAggregationsArgs) => {
      const { filters, timeSeriesInterval } = args;
      const today = new Date().toISOString().split("T")[0];
      const indexName = `logs-${today}`;

      try {
        await ensureIndexExists(indexName);

        const response = await opensearchClient.search({
          index: indexName,
          body: {
            query: buildQuery(filters),
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
              time_series: {
                date_histogram: {
                  field: "timestamp",
                  fixed_interval: timeSeriesInterval?.interval || "1h",
                },
              },
            },
          },
        });

        const aggs = response.body.aggregations;
        if (!aggs) {
          return {
            byLevel: { buckets: [] },
            byService: { buckets: [] },
            timeSeries: [],
            totalLogs: getTotalHits(response.body.hits.total),
          };
        }

        const byLevel = aggs.by_level as any;
        const byService = aggs.by_service as any;
        const timeSeries = aggs.time_series as any;

        return {
          byLevel: {
            buckets: (byLevel?.buckets || []).map((b: any) => ({
              key: b.key,
              count: b.doc_count,
            })),
          },
          byService: {
            buckets: (byService?.buckets || []).map((b: any) => ({
              key: b.key,
              count: b.doc_count,
            })),
          },
          timeSeries: (timeSeries?.buckets || []).map((b: any) => ({
            timestamp: new Date(b.key).toISOString(),
            count: b.doc_count,
          })),
          totalLogs: getTotalHits(response.body.hits.total),
        };
      } catch (error) {
        console.error("Error fetching aggregations:", error);
        throw new Error("Failed to fetch aggregations");
      }
    },

    // Busca por similaridade usando More Like This
    similarLogs: async (_: any, args: SimilarLogsArgs) => {
      const { logId, limit = 10 } = args;
      const today = new Date().toISOString().split("T")[0];
      const indexName = `logs-${today}`;

      try {
        await ensureIndexExists(indexName);

        const response = await opensearchClient.search({
          index: indexName,
          body: {
            query: {
              more_like_this: {
                fields: ["message", "error.message", "error.type"],
                like: [
                  {
                    _index: indexName,
                    _id: logId,
                  },
                ],
                min_term_freq: 1,
                max_query_terms: 12,
              },
            },
            size: limit,
          },
        });

        return response.body.hits.hits.map((hit: any) => ({
          log: {
            id: hit._id,
            ...hit._source,
          },
          score: hit._score,
        }));
      } catch (error) {
        console.error("Error finding similar logs:", error);
        throw new Error("Failed to find similar logs");
      }
    },

    // Busca textual avançada
    searchLogs: async (_: any, args: SearchLogsArgs) => {
      const { query, filters, limit = 20, offset = 0 } = args;
      const today = new Date().toISOString().split("T")[0];
      const indexName = `logs-${today}`;

      try {
        await ensureIndexExists(indexName);

        const searchQuery = buildQuery({ ...filters, searchText: query });

        const response = await opensearchClient.search({
          index: indexName,
          body: {
            query: searchQuery,
            from: offset,
            size: limit,
            sort: [
              { _score: { order: "desc" } },
              { timestamp: { order: "desc" } },
            ],
            highlight: {
              fields: {
                message: {},
                "error.message": {},
              },
            },
          },
        });

        const logs = response.body.hits.hits.map((hit: any) => ({
          id: hit._id,
          ...hit._source,
          _highlight: hit.highlight, // Pode adicionar highlight no schema se quiser
        }));

        const total = getTotalHits(response.body.hits.total);

        return {
          logs,
          total,
          pageInfo: {
            hasNextPage: offset + limit < total,
            hasPreviousPage: offset > 0,
          },
        };
      } catch (error) {
        console.error("Error searching logs:", error);
        throw new Error("Failed to search logs");
      }
    },
  },
};
