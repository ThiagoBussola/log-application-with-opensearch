import { opensearchClient } from "../config/opensearch.config";
import { LOG_INDEX_TEMPLATE } from "./index-template";
import type { Indices_PutIndexTemplate_RequestBody } from "@opensearch-project/opensearch/api/indices/putIndexTemplate";

export async function setupIndexTemplate() {
  try {
    const response = await opensearchClient.indices.putIndexTemplate({
      name: "logs-template",
      body: LOG_INDEX_TEMPLATE as Indices_PutIndexTemplate_RequestBody,
    });
    return response;
  } catch (error: any) {
    console.error("Error creating index template:", error.meta?.body || error);
    throw error;
  }
}

export async function createTodayIndex() {
  const today = new Date().toISOString().split("T")[0];
  const indexName = `logs-${today}`;

  try {
    const exists = await opensearchClient.indices.exists({ index: indexName });

    if (exists.body) {
      console.log(`Index ${indexName} already exists`);
      return indexName;
    }

    console.log(`Creating index: ${indexName}`);
    await opensearchClient.indices.create({ index: indexName });
    console.log(`Index ${indexName} created successfully`);

    return indexName;
  } catch (error: any) {
    console.error("Error creating index:", error.meta?.body || error);
    throw error;
  }
}

/**
 * Creates an index optimized for bulk loading operations.
 * This function temporarily disables refresh and reduces replicas for faster ingestion.
 * After bulk loading is complete, you should call optimizeIndexForSearch() to restore normal settings.
 */
export async function createBulkOptimizedIndex(
  indexName: string,
  options?: {
    refreshInterval?: string; // Default: "-1" (disabled)
    replicas?: number; // Default: 0
    shards?: number; // Default: 10
  }
): Promise<void> {
  try {
    const exists = await opensearchClient.indices.exists({ index: indexName });
    if (exists.body) {
      throw new Error(`Index ${indexName} already exists`);
    }

    await opensearchClient.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: options?.shards || 10,
          number_of_replicas: options?.replicas || 0,
          refresh_interval: options?.refreshInterval || "-1",
          "index.translog.durability": "async",
          "index.translog.sync_interval": "60s",
          codec: "best_compression",
          analysis: LOG_INDEX_TEMPLATE.template.settings.analysis as any,
        },
        mappings: LOG_INDEX_TEMPLATE.template.mappings as any,
      },
    });
  } catch (error: any) {
    console.error(
      "Error creating bulk-optimized index:",
      error.meta?.body || error
    );
    throw error;
  }
}

/**
 * Optimizes an index for search operations after bulk loading is complete.
 * This restores refresh interval and replica settings for normal operation.
 */
export async function optimizeIndexForSearch(
  indexName: string,
  options?: {
    refreshInterval?: string; // Default: "30s"
    replicas?: number; // Default: 1
  }
): Promise<void> {
  try {
    const exists = await opensearchClient.indices.exists({ index: indexName });
    if (!exists.body) {
      throw new Error(`Index ${indexName} does not exist`);
    }

    await opensearchClient.indices.putSettings({
      index: indexName,
      body: {
        settings: {
          refresh_interval: options?.refreshInterval || "30s",
          number_of_replicas: options?.replicas || 1,
          "index.translog.durability": "request",
        },
      },
    });

    await opensearchClient.indices.refresh({ index: indexName });
  } catch (error: any) {
    console.error(
      "Error optimizing index for search:",
      error.meta?.body || error
    );
    throw error;
  }
}

export async function setupOpenSearch() {
  await setupIndexTemplate();
  const indexName = await createTodayIndex();
  return indexName;
}
