import { expect } from "chai";
import { generateLog } from "../scripts/generators/log-generator";

describe("generateLog", () => {
  it("produces logs with required fields populated", () => {
    const log = generateLog();

    expect(log.id).to.be.a("string").and.not.empty;
    expect(() => new Date(log.timestamp)).to.not.throw();
    expect(log.service.name).to.be.a("string").and.not.empty;
    expect(log.service.environment).to.be.oneOf([
      "production",
      "staging",
      "development",
    ]);
    expect(log.level).to.be.oneOf([
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "fatal",
    ]);
    expect(log.metrics.cpu_usage).to.be.within(0, 100);
    expect(log.metrics.response_time_ms).to.be.greaterThan(0);
    expect(log.tags).to.be.an("array");
  });

  it("respects provided base date for timestamp generation", () => {
    const baseDate = new Date("2024-01-01T00:00:00.000Z");
    const log = generateLog(baseDate);

    const generatedDate = new Date(log.timestamp);
    expect(generatedDate.toISOString().split("T")[0]).to.equal(
      baseDate.toISOString().split("T")[0]
    );
  });
});
