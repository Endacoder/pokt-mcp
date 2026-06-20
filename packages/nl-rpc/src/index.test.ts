import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createNlRpcEngine } from "../src/index.js";

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/queries.json"), "utf8"),
) as Array<{ query: string; expectMethod: string; expectChain: string; expectWrite?: boolean }>;

describe("nl-rpc fixtures", () => {
  const engine = createNlRpcEngine();

  for (const fixture of fixtures) {
    it(`parses: ${fixture.query.slice(0, 50)}`, async () => {
      const parsed = await engine.parse(fixture.query);
      expect(parsed.intent.method).toBe(fixture.expectMethod);
      expect(parsed.intent.chain).toBe(fixture.expectChain);
      if (fixture.expectWrite) {
        expect(parsed.requiresConfirmation).toBe(true);
      }
    });
  }
});

describe("accuracy threshold", () => {
  it("passes at least 90% of fixtures", async () => {
    const engine = createNlRpcEngine();
    let passed = 0;
    for (const fixture of fixtures) {
      try {
        const parsed = await engine.parse(fixture.query);
        if (parsed.intent.method === fixture.expectMethod && parsed.intent.chain === fixture.expectChain) {
          passed++;
        }
      } catch {
        // count as fail
      }
    }
    expect(passed / fixtures.length).toBeGreaterThanOrEqual(0.9);
  });
});
