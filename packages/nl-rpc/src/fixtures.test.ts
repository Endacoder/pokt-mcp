import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChatHistoryMessage, SessionContext } from "@pokt-mcp/shared";
import { createNlRpcEngine } from "./index.js";

type FollowUpFixture = {
  id: string;
  turns?: ChatHistoryMessage[];
  query: string;
  sessionContext?: SessionContext;
  expectMethod: string;
  expectParams?: unknown[];
  expectParamsPrefix?: unknown[];
};

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const followUpPairs = JSON.parse(
  readFileSync(join(fixturesDir, "follow-up-pairs.json"), "utf8"),
) as FollowUpFixture[];

describe("follow-up-pairs fixtures", () => {
  const engine = createNlRpcEngine({ llm: null });

  for (const fixture of followUpPairs) {
    it(fixture.id, async () => {
      const result = await engine.parse(
        fixture.query,
        fixture.sessionContext,
        fixture.turns,
      );
      expect(result.intent.method).toBe(fixture.expectMethod);
      if (fixture.expectParams) {
        expect(result.intent.params).toEqual(fixture.expectParams);
      }
      if (fixture.expectParamsPrefix) {
        for (let i = 0; i < fixture.expectParamsPrefix.length; i++) {
          expect(result.intent.params[i]).toBe(fixture.expectParamsPrefix[i]);
        }
      }
    });
  }
});
