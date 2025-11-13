import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { logTypeDefs } from "./graphql/schemas/log.schema";
import { logResolvers } from "./graphql/resolvers/log.resolvers";
import { testConnection } from "./config/opensearch.config";
import * as dotenv from "dotenv";

dotenv.config();

async function startServer() {
  console.log("Testing OpenSearch connection...");
  const connected = await testConnection();

  if (!connected) {
    console.error("Failed to connect to OpenSearch. Exiting...");
    process.exit(1);
  }

  const server = new ApolloServer({
    typeDefs: logTypeDefs,
    resolvers: logResolvers,
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: parseInt(process.env.PORT || "4000") },
  });

  console.log(`\nServer ready at: ${url}`);
  console.log(`GraphQL Playground available at: ${url}`);
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
