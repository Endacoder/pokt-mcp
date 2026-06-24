import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createPocketClient } from "@pokt-mcp/pocket-client";
import type { LlmConfig } from "@pokt-mcp/shared";
import { routeQuery } from "./query-router.js";

const mockLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "sk-test",
  baseUrl: "https://api.test/v1",
  model: "gpt-4o-mini",
  enabled: true,
};

describe("routeQuery", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("FEATURE_NL_LLM", "true");
    vi.stubEnv("FEATURE_AGENT_LOOP", "true");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("LLM_MODEL", "gpt-4o-mini");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("routes USDC transfer events to intent instead of agent", async () => {
    const wallet = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const pocket = {
      rpc: vi.fn(async (_chain: string, method: string) => {
        if (method === "eth_blockNumber") return { result: "0x1000", meta: {} };
        if (method === "eth_getLogs") return { result: [], meta: {} };
        throw new Error(method);
      }),
    };

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: `Recent USDC Transfer events for ${wallet} on eth`,
      sessionContext: { defaultChain: "eth" },
      pocket: pocket as never,
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    expect((result?.data as { answer?: string }).answer).toContain("No USDC Transfer events");
  });

  it("routes bytecode queries to intent instead of agent", async () => {
    const pocket = {
      rpc: vi.fn(async () => ({
        result: "0x60806040",
        meta: {},
      })),
    };

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "Bytecode at 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 on eth",
      sessionContext: { defaultChain: "eth" },
      pocket: pocket as never,
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    expect((result?.data as { answer?: string }).answer).toContain("Contract bytecode");
  });

  it("routes complex queries to agent", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "Done." } }],
      }),
    ) as typeof fetch;

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "recent USDC transfers for 0xabc",
      sessionContext: { defaultChain: "eth" },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "agent" });
  });

  it("uses intent route for simple template queries", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "latest block on base",
      sessionContext: { defaultChain: "eth" },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
  });

  it("routes my wallet balance to intent with connected address", async () => {
    const pocket = {
      rpc: vi.fn(async (_chain: string, method: string) => {
        if (method === "eth_getBalance") return { result: "0xde0b6b3a7640000", meta: {} };
        if (method === "eth_call") return { result: "0x0", meta: {} };
        throw new Error(method);
      }),
    };

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "what is my wallet balance",
      sessionContext: {
        defaultChain: "eth",
        connectedAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      },
      pocket: pocket as never,
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    expect((result?.data as { answer?: string }).answer).toContain("ETH:");
  });

  it("redirects swap execution when Intent MCP is not configured", async () => {
    vi.stubEnv("INTENT_MCP_API_KEY", "");
    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "swap 50 USDC to ETH on Base",
      sessionContext: { defaultChain: "base" },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const err = events.find((e) => e.type === "error");
    expect(err?.data).toMatchObject({ requiresThirdPartySwapMcp: true });
    expect((err?.data as { message: string }).message).toContain("INTENT_MCP_API_KEY");
  });

  it("routes swap to intent-mcp REST when API URL is local", async () => {
    vi.stubEnv("INTENT_MCP_API_KEY", "test-key");
    vi.stubEnv("INTENT_MCP_API_URL", "http://intent.test");
    vi.stubEnv("INTENT_MCP_REMOTE_URL", "");

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/v1/tokens/search") && path.includes("USDC")) {
        return Response.json({
          tokens: [{ address: "0xusdc", symbol: "USDC", decimals: 6 }],
        });
      }
      if (path.includes("/v1/tokens/search") && path.includes("WETH")) {
        return Response.json({
          tokens: [{ address: "0xweth", symbol: "WETH", decimals: 18 }],
        });
      }
      if (path.includes("/v1/quote")) {
        return Response.json({
          quote: {
            quoteId: "q1",
            expiresAt: "2026-06-19T12:00:00.000Z",
            route: "Intent route on Base",
            routeType: "same-chain",
            fromChain: 8453,
            toChain: 8453,
            tokenIn: { address: "0xusdc", symbol: "USDC", amount: "50000000" },
            tokenOut: { address: "0xweth", symbol: "WETH", amountEstimated: "14000000000000000" },
            platformFeeBps: 25,
            warnings: [],
          },
        });
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    }) as typeof fetch;

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "swap 50 USDC to ETH on Base",
      sessionContext: { defaultChain: "base" },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent-swap" });
    expect((result?.data as { answer?: string }).answer).toContain("USDC");
  });

  it("returns connect prompt when wallet not connected", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "what is my wallet balance",
      sessionContext: { defaultChain: "eth" },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const err = events.find((e) => e.type === "error");
    expect(err?.data).toMatchObject({
      code: "WALLET_NOT_CONNECTED",
      message: "Connect your wallet to check your balance.",
    });
  });

  it("routes spot price queries to intent via CoinGecko", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ bitcoin: { usd: 97500.25 } }),
    ) as typeof fetch;

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "what is btc price right now",
      sessionContext: { defaultChain: "eth" },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    expect((result?.data as { answer?: string }).answer).toContain("BTC spot price");
  });

  it("answers data source questions via meta intent", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "are you using the chain rpc or coin gecko api",
      sessionContext: { defaultChain: "eth" },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    expect((result?.data as { answer?: string }).answer).toContain("CoinGecko");
  });

  it("interprets qualitative gas queries with contextual answer", async () => {
    vi.stubEnv("FEATURE_NL_LLM", "false");

    const pocket = {
      rpc: vi.fn(async () => ({
        result: "0x4a817c800", // 20 gwei
        meta: {},
      })),
    };

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "is the gas price low or high right now",
      sessionContext: { defaultChain: "eth" },
      pocket: pocket as never,
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    const answer = (result?.data as { answer?: string }).answer ?? "";
    expect(answer.toLowerCase()).toMatch(/normal|low|high|gwei/);
    expect(answer).not.toMatch(/^Gas price on eth: \d+\.\d+ gwei$/);
  });

  it("returns helpful message when transaction is not found", async () => {
    vi.stubEnv("TX_LOOKUP_POLL_TIMEOUT_MS", "100");
    const pocket = {
      rpc: vi.fn(async () => ({ result: null, meta: { chain: "eth", method: "eth_getTransactionByHash" } })),
    };

    const hash = "0x88df016429689c079c3bbe9e64b4f6bb4e2b1a6664245edaa2330f0a0b6b5891";
    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: `Transaction ${hash} on eth`,
      sessionContext: { defaultChain: "eth" },
      pocket: pocket as never,
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    const answer = (result?.data as { answer?: string }).answer ?? "";
    expect(answer).toMatch(/No (transaction|receipt) found/);
    expect(answer).toContain("Possible reasons:");
    expect(answer).toContain("etherscan.io");
  });

  it("converts multi-chain portfolio to USD on follow-up", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        ethereum: { usd: 1721.97 },
        "polygon-ecosystem-token": { usd: 0.25 },
        binancecoin: { usd: 600 },
      }),
    ) as typeof fetch;

    const portfolio = {
      address: "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
      scanned: 20,
      chains: [
        {
          chain: "eth",
          chainName: "Ethereum Mainnet",
          nativeSymbol: "ETH",
          nativeBalance: "0.000152",
          tokens: [],
        },
        {
          chain: "base",
          chainName: "Base",
          nativeSymbol: "ETH",
          nativeBalance: "0.000001",
          tokens: [{ symbol: "USDC", balance: "0.071581" }],
        },
      ],
    };

    const pocket = {
      rpc: vi.fn(async () => ({ result: "0x0", meta: {} })),
    };

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "whats that in USD",
      sessionContext: {
        defaultChain: "eth",
        lastWalletPortfolio: portfolio,
      },
      pocket: pocket as never,
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    const answer = (result?.data as { answer?: string }).answer ?? "";
    expect(answer).toContain("across 2 chains");
    expect(answer).toContain("USDC");
    expect(answer).not.toContain("0 ETH ≈ 0.00 USD");
  });

  it("routes BTC week follow-up after session remembers market query", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("coingecko")) {
        return Response.json({
          market_data: {
            price_change_percentage_7d: 3.5,
            current_price: { usd: 97000 },
          },
        });
      }
      return Response.json({});
    }) as typeof fetch;

    const sessionContext = {
      defaultChain: "eth",
      lastMarketQuery: {
        symbol: "BTC",
        coingeckoId: "bitcoin",
        kind: "priceChange" as const,
        period: "24h" as const,
      },
    };

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "how about for the week",
      sessionContext,
      history: [
        { role: "user" as const, content: "how has btc been doing" },
        { role: "assistant" as const, content: "BTC 24h change: +1%" },
      ],
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    expect((result?.data as { answer?: string }).answer).toContain("BTC 7d change");
  });

  it("routes gas temporal follow-up from lastQuery session", async () => {
    const pocket = {
      rpc: vi.fn(async (_chain: string, method: string) => {
        if (method === "eth_feeHistory") {
          return {
            result: { oldestBlock: "0x900", baseFeePerGas: ["0x4a817c800"] },
            meta: {},
          };
        }
        throw new Error(method);
      }),
    };

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "what was it 1 hour ago",
      sessionContext: {
        defaultChain: "eth",
        lastQuery: {
          chain: "eth",
          method: "eth_gasPrice",
          subject: "gas",
          params: [],
        },
      },
      pocket: pocket as never,
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    const answer = (result?.data as { answer?: string }).answer ?? "";
    expect(answer.toLowerCase()).toMatch(/gas|gwei|hour/);
  });

  it("routes ETH in 1 week follow-up after 24h market session", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("coingecko")) {
        return Response.json({
          market_data: {
            price_change_percentage_7d: 2.1,
            current_price: { usd: 1735 },
          },
        });
      }
      return Response.json({});
    }) as typeof fetch;

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "in 1 week",
      sessionContext: {
        defaultChain: "eth",
        lastMarketQuery: {
          symbol: "ETH",
          coingeckoId: "ethereum",
          kind: "priceChange" as const,
          period: "24h" as const,
        },
      },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    expect((result?.data as { answer?: string }).answer).toContain("ETH 7d change");
  });

  it("explains unsupported market period for in 3 days after 7d session", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of routeQuery({
      query: "in 3 days",
      sessionContext: {
        defaultChain: "eth",
        lastMarketQuery: {
          symbol: "ETH",
          coingeckoId: "ethereum",
          kind: "priceChange" as const,
          period: "7d" as const,
        },
      },
      pocket: createPocketClient(),
    })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === "result");
    expect(result?.data).toMatchObject({ route: "intent" });
    const answer = (result?.data as { answer?: string }).answer ?? "";
    expect(answer).toMatch(/CoinGecko does not provide/i);
    expect(answer).not.toMatch(/7d change/i);
  });
});
