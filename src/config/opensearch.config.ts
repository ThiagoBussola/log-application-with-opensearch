import { Client } from "@opensearch-project/opensearch";
import * as dotenv from "dotenv";

dotenv.config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

if (!process.env.OPENSEARCH_USERNAME || !process.env.OPENSEARCH_PASSWORD) {
  throw new Error("OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD are required");
}

export const opensearchClient = new Client({
  node: process.env.OPENSEARCH_NODE || "https://localhost:9200",
  auth: {
    username: process.env.OPENSEARCH_USERNAME,
    password: process.env.OPENSEARCH_PASSWORD,
  },
  ssl: {
    rejectUnauthorized: false,
  },
  requestTimeout: 60000,
  pingTimeout: 3000,
});

export async function testConnection() {
  try {
    const health = await opensearchClient.cluster.health();
    console.log("OpenSearch connected:", health.body);
    return true;
  } catch (error) {
    console.error("OpenSearch connection failed:", error);
    return false;
  }
}

export async function closeClient(): Promise<void> {
  try {
    await opensearchClient.close();
  } catch (error) {
    console.error("Error closing OpenSearch client:", error);
  }
}
