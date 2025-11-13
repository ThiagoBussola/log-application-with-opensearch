import {
  opensearchClient,
  testConnection,
  closeClient,
} from "../config/opensearch.config";

interface IndexStats {
  name: string;
  documents: number;
  size: string;
  sizeBytes: number;
  shards: number;
  replicas: number;
  status: string;
}

interface ClusterStats {
  documents: number;
  indices: number;
  heapUsed: string;
  heapMax: string;
  heapPercent: number;
  diskUsed: string;
  diskTotal: string;
  diskPercent: number;
}

function parseArgs(): { index?: string } {
  const args = process.argv.slice(2);
  const options: { index?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--index" && args[i + 1]) {
      options.index = args[i + 1];
      i++;
    }
  }

  return options;
}

async function getIndexStats(indexName?: string): Promise<IndexStats[]> {
  try {
    const indices = indexName
      ? [indexName]
      : (await opensearchClient.cat.indices({ format: "json" })).body.map(
          (idx: any) => idx.index
        );

    const stats: IndexStats[] = [];

    for (const idx of indices) {
      try {
        const [statsResp, healthResp] = await Promise.all([
          opensearchClient.indices.stats({ index: idx }),
          opensearchClient.indices.get({ index: idx }),
        ]);

        const indexStats = statsResp.body.indices?.[idx];
        const indexHealth = healthResp.body[idx];

        if (!indexStats) {
          console.warn(`No stats found for index ${idx}`);
          continue;
        }

        const totalDocs = indexStats.total?.docs?.count || 0;
        const storeSize = indexStats.total?.store?.size_in_bytes || 0;
        const shards = indexHealth.settings?.index?.number_of_shards || "1";
        const replicas = indexHealth.settings?.index?.number_of_replicas || "0";

        stats.push({
          name: idx,
          documents: totalDocs,
          size: formatBytes(storeSize),
          sizeBytes: storeSize,
          shards: parseInt(String(shards)),
          replicas: parseInt(String(replicas)),
          status: indexHealth.settings?.index?.verified_before_close
            ? "closed"
            : "open",
        });
      } catch (error) {
        console.warn(`Failed to get stats for index ${idx}:`, error);
      }
    }

    return stats.sort((a, b) => b.sizeBytes - a.sizeBytes);
  } catch (error) {
    console.error("Error getting index stats:", error);
    return [];
  }
}

async function getClusterStats(): Promise<ClusterStats> {
  try {
    const [clusterStats, indicesStats, nodesStats] = await Promise.all([
      opensearchClient.cluster.stats(),
      opensearchClient.indices.stats(),
      opensearchClient.nodes.stats(),
    ]);

    const totalDocs = clusterStats.body.indices?.docs?.count || 0;
    const totalIndices = clusterStats.body.indices?.count || 0;

    // Get heap usage from nodes stats
    const nodes = nodesStats.body.nodes || {};
    let totalHeapUsed = 0;
    let totalHeapMax = 0;

    for (const nodeId in nodes) {
      const node = nodes[nodeId];
      totalHeapUsed += node.jvm?.mem?.heap_used_in_bytes || 0;
      totalHeapMax += node.jvm?.mem?.heap_max_in_bytes || 0;
    }

    const heapPercent =
      totalHeapMax > 0 ? (totalHeapUsed / totalHeapMax) * 100 : 0;

    // Get disk usage
    const fs = (clusterStats.body.nodes?.fs as any) || {};
    const totalDiskBytes = fs.total_in_bytes || 0;
    const availableDiskBytes = fs.available_in_bytes || 0;
    const usedDiskBytes = totalDiskBytes - availableDiskBytes;
    const diskPercent =
      totalDiskBytes > 0 ? (usedDiskBytes / totalDiskBytes) * 100 : 0;

    return {
      documents: totalDocs,
      indices: totalIndices,
      heapUsed: formatBytes(totalHeapUsed),
      heapMax: formatBytes(totalHeapMax),
      heapPercent: Math.round(heapPercent * 100) / 100,
      diskUsed: formatBytes(usedDiskBytes),
      diskTotal: formatBytes(totalDiskBytes),
      diskPercent: Math.round(diskPercent * 100) / 100,
    };
  } catch (error) {
    console.error("Error getting cluster stats:", error);
    throw error;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function printStats(
  clusterStats: ClusterStats,
  indexStats: IndexStats[]
): void {
  console.log("\n" + "=".repeat(80));
  console.log("OpenSearch Cluster Statistics");
  console.log("=".repeat(80));

  console.log("\n📊 Cluster Overview:");
  console.log(`  Total Documents: ${clusterStats.documents.toLocaleString()}`);
  console.log(`  Total Indices: ${clusterStats.indices}`);
  console.log(
    `  Heap Usage: ${clusterStats.heapUsed} / ${clusterStats.heapMax} (${clusterStats.heapPercent}%)`
  );
  console.log(
    `  Disk Usage: ${clusterStats.diskUsed} / ${clusterStats.diskTotal} (${clusterStats.diskPercent}%)`
  );

  if (indexStats.length > 0) {
    console.log("\n📁 Index Statistics:");
    console.log(
      "  " +
        "Index".padEnd(40) +
        "Documents".padStart(15) +
        "Size".padStart(12) +
        "Shards".padStart(8) +
        "Replicas".padStart(10) +
        "Status".padStart(8)
    );
    console.log("  " + "-".repeat(93));

    const topIndices = indexStats.slice(0, 10);
    for (const idx of topIndices) {
      console.log(
        "  " +
          idx.name.padEnd(40) +
          idx.documents.toLocaleString().padStart(15) +
          idx.size.padStart(12) +
          idx.shards.toString().padStart(8) +
          idx.replicas.toString().padStart(10) +
          idx.status.padStart(8)
      );
    }

    if (indexStats.length > 10) {
      console.log(`  ... and ${indexStats.length - 10} more indices`);
    }

    // Summary by pattern
    const logsIndices = indexStats.filter((idx) =>
      idx.name.startsWith("logs-")
    );
    if (logsIndices.length > 0) {
      const totalLogsDocs = logsIndices.reduce(
        (sum, idx) => sum + idx.documents,
        0
      );
      const totalLogsSize = logsIndices.reduce(
        (sum, idx) => sum + idx.sizeBytes,
        0
      );
      console.log("\n📋 Logs Indices Summary:");
      console.log(`  Total indices: ${logsIndices.length}`);
      console.log(`  Total documents: ${totalLogsDocs.toLocaleString()}`);
      console.log(`  Total size: ${formatBytes(totalLogsSize)}`);
    }
  }

  console.log("\n" + "=".repeat(80) + "\n");
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log("Connecting to OpenSearch...");
  const connected = await testConnection();
  if (!connected) {
    console.error("Unable to connect to OpenSearch cluster. Aborting.");
    process.exit(1);
    return;
  }

  try {
    const clusterStats = await getClusterStats();
    const indexStats = await getIndexStats(options.index);
    printStats(clusterStats, indexStats);
  } catch (error) {
    console.error("Error retrieving statistics:", error);
    process.exit(1);
  } finally {
    await closeClient();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { getIndexStats, getClusterStats, formatBytes };
