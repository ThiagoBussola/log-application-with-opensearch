import { pipeline } from "stream/promises";
import * as fs from "fs";
import { generateLog } from "./generators/log-generator";
import { LogEntry } from "../types/log.types";

async function* generateLogsStream(
  numberOfLogs: number,
  baseDate: Date = new Date()
): AsyncGenerator<string, void, unknown> {
  for (let i = 0; i < numberOfLogs; i++) {
    const log = generateLog(baseDate);
    yield JSON.stringify(log) + "\n";
  }
}

export async function generateLogsToNDJSON(
  filePath: string,
  numberOfLogs: number,
  baseDate: Date = new Date()
): Promise<void> {
  const writeStream = fs.createWriteStream(filePath);

  try {
    await pipeline(generateLogsStream(numberOfLogs, baseDate), writeStream);
    console.log(
      `Generated ${numberOfLogs.toLocaleString()} logs to ${filePath}`
    );
  } catch (error) {
    console.error("Error generating logs to file:", error);
    throw error;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const numberOfLogs = parseInt(args[0]) || 100000;
  const filePath = args[1] || "logs.ndjson";
  const baseDate = args[2] ? new Date(args[2]) : new Date();

  (async () => {
    await generateLogsToNDJSON(filePath, numberOfLogs, baseDate);
    process.exit(0);
  })().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
