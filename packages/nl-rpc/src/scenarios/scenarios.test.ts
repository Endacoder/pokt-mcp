import { describe, expect, it } from "vitest";
import { createNlRpcEngine } from "../index.js";
import { generateParseScenarios, MIN_SCENARIO_COUNT } from "./generate-scenarios.js";
import type { ParseScenario } from "./types.js";

const BATCH_SIZE = 1000;

async function runScenario(
  engine: ReturnType<typeof createNlRpcEngine>,
  scenario: ParseScenario,
): Promise<string | null> {
  try {
    const result = await engine.parse(scenario.query, scenario.sessionContext, scenario.turns);
    if (result.intent.method !== scenario.expectMethod) {
      return `id=${scenario.id} query="${scenario.query}" method=${result.intent.method} want=${scenario.expectMethod}`;
    }
    if (scenario.expectChain && result.intent.chain !== scenario.expectChain) {
      return `id=${scenario.id} chain=${result.intent.chain} want=${scenario.expectChain}`;
    }
    if (scenario.expectParams && JSON.stringify(result.intent.params) !== JSON.stringify(scenario.expectParams)) {
      return `id=${scenario.id} params=${JSON.stringify(result.intent.params)} want=${JSON.stringify(scenario.expectParams)}`;
    }
    if (scenario.expectParamsPrefix) {
      for (let i = 0; i < scenario.expectParamsPrefix.length; i++) {
        if (result.intent.params[i] !== scenario.expectParamsPrefix[i]) {
          return `id=${scenario.id} params[${i}]=${result.intent.params[i]} want=${scenario.expectParamsPrefix[i]}`;
        }
      }
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `id=${scenario.id} query="${scenario.query}" error=${msg}`;
  }
}

describe("generated parse scenarios", () => {
  const scenarios = generateParseScenarios();

  it(`generates at least ${MIN_SCENARIO_COUNT} scenarios`, () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(MIN_SCENARIO_COUNT);
  });

  const engine = createNlRpcEngine({ llm: null });
  const batchCount = Math.ceil(scenarios.length / BATCH_SIZE);

  for (let batch = 0; batch < batchCount; batch++) {
    const start = batch * BATCH_SIZE;
    const slice = scenarios.slice(start, start + BATCH_SIZE);

    it(`batch ${batch + 1}/${batchCount} (${slice.length} scenarios)`, async () => {
      const failures: string[] = [];
      for (const scenario of slice) {
        const failure = await runScenario(engine, scenario);
        if (failure) failures.push(failure);
      }
      if (failures.length > 0) {
        const sample = failures.slice(0, 15).join("\n");
        expect.fail(`${failures.length} failures in batch ${batch + 1}:\n${sample}`);
      }
    });
  }
});
