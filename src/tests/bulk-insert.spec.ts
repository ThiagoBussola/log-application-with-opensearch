import { expect } from "chai";
import { once } from "events";
import { BulkInsertTransform } from "../scripts/bulk-insert";
import { opensearchClient } from "../config/opensearch.config";
import { createLogEntry } from "./helpers/log-fixtures";

describe("BulkInsertTransform", () => {
  const originalBulk = opensearchClient.bulk.bind(opensearchClient);

  afterEach(() => {
    opensearchClient.bulk = originalBulk;
  });

  it("flushes batches and reports metrics", async () => {
    const bulkCalls: any[] = [];
    // @ts-expect-error mocking bulk for tests
    opensearchClient.bulk = async ({ body }: { body: any }) => {
      bulkCalls.push(body);
      // NDJSON format: each document has action line + doc line
      const lines = typeof body === "string" ? body.trimEnd().split("\n") : [];
      const docCount = lines.length / 2;
      return {
        body: {
          errors: false,
          items: Array(docCount)
            .fill(null)
            .map(() => ({ index: {} })),
        },
      };
    };

    const transform = new BulkInsertTransform({
      indexName: "logs-test",
      batchSize: 2,
    });

    const emitted: Array<{ inserted: number; total: number }> = [];
    transform.on("data", (chunk) => emitted.push(chunk));

    transform.write(createLogEntry({ id: "log-1" }));
    transform.write(createLogEntry({ id: "log-2" }));
    transform.end();
    await once(transform, "finish");

    expect(bulkCalls).to.have.lengthOf(1);
    expect(emitted).to.deep.include({ inserted: 2, total: 2 });

    const metrics = transform.getMetrics();
    expect(metrics.batches).to.equal(1);
    expect(metrics.totalInserted).to.equal(2);
    expect(metrics.failedDocuments).to.equal(0);
  });

  it("tracks failed documents from bulk responses", async () => {
    // @ts-expect-error mocking bulk for tests
    opensearchClient.bulk = async () => ({
      body: {
        errors: true,
        items: [
          { index: {} },
          {
            index: {
              error: {
                type: "mapper_parsing_exception",
                reason: "failed to parse",
              },
            },
          },
        ],
      },
    });

    const transform = new BulkInsertTransform({
      indexName: "logs-test",
      batchSize: 2,
    });

    const emitted: Array<{ inserted: number; total: number }> = [];
    transform.on("data", (chunk) => emitted.push(chunk));

    transform.write(createLogEntry({ id: "log-1" }));
    transform.write(createLogEntry({ id: "log-2" }));
    transform.end();
    await once(transform, "finish");

    expect(emitted).to.deep.include({ inserted: 1, total: 1 });

    const metrics = transform.getMetrics();
    expect(metrics.failedDocuments).to.equal(1);
    expect(metrics.totalInserted).to.equal(1);
  });

  it("serializes batches as NDJSON", async () => {
    let capturedBody: string | null = null;
    // @ts-expect-error mocking bulk for tests
    opensearchClient.bulk = async ({ body }: { body: any }) => {
      capturedBody = body;
      return {
        body: {
          errors: false,
          items: [],
        },
      };
    };

    const transform = new BulkInsertTransform({
      indexName: "logs-test",
      batchSize: 2,
    });

    transform.write(createLogEntry({ id: "log-1" }));
    transform.write(createLogEntry({ id: "log-2" }));
    transform.end();
    await once(transform, "finish");

    expect(capturedBody).to.be.a("string");
    const lines = capturedBody!.trimEnd().split("\n");
    expect(lines).to.have.lengthOf(4);

    const firstAction = JSON.parse(lines[0]);
    const firstDoc = JSON.parse(lines[1]);
    const secondAction = JSON.parse(lines[2]);

    expect(firstAction).to.deep.equal({ index: { _index: "logs-test" } });
    expect(firstDoc.id).to.equal("log-1");
    expect(secondAction).to.deep.equal({ index: { _index: "logs-test" } });
  });
});
