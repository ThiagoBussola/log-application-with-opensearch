// Types for OpenSearch aggregation responses
export interface AggregationBucket {
  key: string | number;
  doc_count: number;
  [key: string]: any;
}

export interface TermsAggregation {
  buckets: AggregationBucket[];
}

export interface DateHistogramBucket extends AggregationBucket {
  key_as_string?: string;
}

export interface DateHistogramAggregation {
  buckets: DateHistogramBucket[];
}

export interface StatsAggregation {
  count: number;
  min: number;
  max: number;
  avg: number;
  sum: number;
}

export interface OpenSearchAggregations {
  [key: string]:
    | TermsAggregation
    | DateHistogramAggregation
    | StatsAggregation
    | any;
}

export interface OpenSearchHit<T = any> {
  _index: string;
  _id: string;
  _score?: number;
  _source: T;
  highlight?: Record<string, string[]>;
}

export interface OpenSearchHits<T = any> {
  total: number | { value: number; relation: string };
  max_score?: number;
  hits: OpenSearchHit<T>[];
}

export interface OpenSearchSearchResponse<T = any> {
  took: number;
  timed_out: boolean;
  _shards: {
    total: number;
    successful: number;
    skipped: number;
    failed: number;
  };
  hits: OpenSearchHits<T>;
  aggregations?: OpenSearchAggregations;
}
