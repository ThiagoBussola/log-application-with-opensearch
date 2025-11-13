import {
  opensearchClient,
  testConnection,
  closeClient,
} from "../config/opensearch.config";

interface CleanupOptions {
  pattern?: string;
  indices?: string[];
  olderThanDays?: number;
  dryRun?: boolean;
  force?: boolean;
  all?: boolean;
}

function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  const options: CleanupOptions = {
    pattern: "logs-*",
    indices: [],
    dryRun: false,
    force: false,
    all: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (!options.indices) options.indices = [];
      options.indices.push(arg);
      continue;
    }

    const [flag, value] = arg.includes("=")
      ? arg.split("=")
      : [arg, args[i + 1]];

    switch (flag) {
      case "--pattern":
        if (value) options.pattern = value;
        if (!arg.includes("=")) i++;
        break;
      case "--indices":
        if (value) {
          options.indices = value.split(",").map((s) => s.trim());
        }
        if (!arg.includes("=")) i++;
        break;
      case "--older-than":
        if (value) options.olderThanDays = Number(value);
        if (!arg.includes("=")) i++;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--all":
        options.all = true;
        options.pattern = "*";
        break;
      default:
        console.warn(`Unknown flag ignored: ${flag}`);
    }
  }

  return options;
}

async function getAllIndices(pattern: string = "*"): Promise<string[]> {
  try {
    const response = await opensearchClient.cat.indices({
      format: "json",
      index: pattern,
    });
    return (response.body as any[]).map((idx) => idx.index);
  } catch (error) {
    console.error("Error getting indices:", error);
    return [];
  }
}

async function getIndexCreationDate(indexName: string): Promise<Date | null> {
  try {
    const response = await opensearchClient.indices.get({
      index: indexName,
    });
    const settings = response.body[indexName]?.settings;
    const creationDate = settings?.index?.creation_date;

    if (creationDate) {
      const dateValue =
        typeof creationDate === "string"
          ? parseInt(creationDate)
          : creationDate;
      return new Date(dateValue * 1000);
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function getIndexStats(indices: string[]): Promise<
  Array<{
    name: string;
    documents: number;
    size: string;
    sizeBytes: number;
    creationDate: Date | null;
  }>
> {
  const stats: Array<{
    name: string;
    documents: number;
    size: string;
    sizeBytes: number;
    creationDate: Date | null;
  }> = [];

  for (const indexName of indices) {
    try {
      const [statsResp, creationDate] = await Promise.all([
        opensearchClient.indices.stats({ index: indexName }),
        getIndexCreationDate(indexName),
      ]);

      const indexStats = statsResp.body.indices?.[indexName];
      if (!indexStats) continue;

      const totalDocs = indexStats.total?.docs?.count || 0;
      const storeSize = indexStats.total?.store?.size_in_bytes || 0;

      stats.push({
        name: indexName,
        documents: totalDocs,
        size: formatBytes(storeSize),
        sizeBytes: storeSize,
        creationDate,
      });
    } catch (error) {
      console.warn(`Failed to get stats for index ${indexName}:`, error);
    }
  }

  return stats.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function filterIndicesByAge(
  stats: Array<{ name: string; creationDate: Date | null }>,
  olderThanDays: number
): string[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  return stats
    .filter((stat) => {
      if (!stat.creationDate) return false;
      return stat.creationDate < cutoffDate;
    })
    .map((stat) => stat.name);
}

async function deleteIndices(
  indices: string[],
  dryRun: boolean
): Promise<void> {
  if (indices.length === 0) {
    console.log("No indices to delete.");
    return;
  }

  if (dryRun) {
    console.log("\n🔍 DRY RUN - Would delete the following indices:");
    indices.forEach((idx) => console.log(`  - ${idx}`));
    return;
  }

  console.log(`\n🗑️  Deleting ${indices.length} indices...`);

  let deleted = 0;
  let failed = 0;

  for (const indexName of indices) {
    try {
      await opensearchClient.indices.delete({ index: indexName });
      console.log(`  ✅ Deleted: ${indexName}`);
      deleted++;
    } catch (error: any) {
      console.error(`  ❌ Failed to delete ${indexName}:`, error.message);
      failed++;
    }
  }

  console.log(`\n📊 Summary: ${deleted} deleted, ${failed} failed`);
}

async function confirmDeletion(
  indices: string[],
  totalSize: string,
  totalDocs: number
): Promise<boolean> {
  console.log("\n⚠️  WARNING: You are about to delete the following:");
  console.log(`  - ${indices.length} indices`);
  console.log(`  - ${totalDocs.toLocaleString()} documents`);
  console.log(`  - ${totalSize} of data`);
  console.log("\nThis action cannot be undone!");

  if (!process.stdin.isTTY) {
    console.log("\n⚠️  Non-interactive mode detected. Use --force to proceed.");
    return false;
  }

  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("\nType 'DELETE' to confirm: ", (answer: string) => {
      rl.close();
      resolve(answer === "DELETE");
    });
  });
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
    let allIndices: string[] = [];

    if (options.indices && options.indices.length > 0) {
      console.log(
        `\n🔍 Using specified indices: ${options.indices.join(", ")}`
      );
      allIndices = options.indices;
    } else {
      console.log(`\n🔍 Finding indices matching pattern: ${options.pattern}`);
      allIndices = await getAllIndices(options.pattern);
    }

    if (allIndices.length === 0) {
      console.log("No indices found.");
      await closeClient();
      process.exit(0);
      return;
    }

    console.log(`Found ${allIndices.length} indices. Getting statistics...`);
    const stats = await getIndexStats(allIndices);

    let indicesToDelete = stats.map((s) => s.name);
    if (
      options.olderThanDays &&
      (!options.indices || options.indices.length === 0)
    ) {
      const oldIndices = filterIndicesByAge(stats, options.olderThanDays);
      console.log(
        `\n📅 Filtering: ${oldIndices.length} indices older than ${options.olderThanDays} days`
      );
      indicesToDelete = oldIndices;
    }

    if (indicesToDelete.length === 0) {
      console.log("No indices match the deletion criteria.");
      await closeClient();
      process.exit(0);
      return;
    }

    // Calculate totals
    const indicesToDeleteSet = new Set(indicesToDelete);
    const totalSize = stats
      .filter((s) => indicesToDeleteSet.has(s.name))
      .reduce((sum, s) => sum + s.sizeBytes, 0);
    const totalDocs = stats
      .filter((s) => indicesToDeleteSet.has(s.name))
      .reduce((sum, s) => sum + s.documents, 0);

    // Show what will be deleted
    console.log("\n📋 Indices to be deleted:");
    console.log(
      "  " +
        "Index".padEnd(40) +
        "Documents".padStart(15) +
        "Size".padStart(12) +
        "Created".padStart(20)
    );
    console.log("  " + "-".repeat(87));

    stats
      .filter((s) => indicesToDeleteSet.has(s.name))
      .slice(0, 20)
      .forEach((stat) => {
        const dateStr = stat.creationDate
          ? stat.creationDate.toISOString().split("T")[0]
          : "unknown";
        console.log(
          "  " +
            stat.name.padEnd(40) +
            stat.documents.toLocaleString().padStart(15) +
            stat.size.padStart(12) +
            dateStr.padStart(20)
        );
      });

    if (indicesToDelete.length > 20) {
      console.log(`  ... and ${indicesToDelete.length - 20} more indices`);
    }

    // Confirm deletion
    if (!options.dryRun && !options.force) {
      const confirmed = await confirmDeletion(
        indicesToDelete,
        formatBytes(totalSize),
        totalDocs
      );
      if (!confirmed) {
        console.log("\n❌ Deletion cancelled.");
        await closeClient();
        process.exit(0);
        return;
      }
    }

    // Delete indices
    await deleteIndices(indicesToDelete, options.dryRun || false);

    if (!options.dryRun) {
      console.log("\n✅ Cleanup completed!");
    }
  } catch (error) {
    console.error("Error during cleanup:", error);
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

export { getAllIndices, getIndexStats, deleteIndices, formatBytes };
