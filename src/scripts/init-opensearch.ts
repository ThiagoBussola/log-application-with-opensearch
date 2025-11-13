import { testConnection } from "../config/opensearch.config";
import { setupOpenSearch } from "../opensearch/setup";

async function init() {
  console.log("Initializing OpenSearch...\n");

  const connected = await testConnection();
  if (!connected) {
    console.error("Cannot connect to OpenSearch. Exiting...");
    process.exit(1);
  }

  console.log("");

  await setupOpenSearch();

  console.log("\nOpenSearch initialization completed!");
  process.exit(0);
}

init().catch((error) => {
  console.error("Initialization failed:", error);
  process.exit(1);
});
