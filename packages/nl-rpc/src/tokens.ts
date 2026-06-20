/** Common ERC-20 contract addresses for LLM/agent prompts. */
export const KNOWN_TOKENS: Record<string, Record<string, { address: string; decimals: number }>> = {
  eth: {
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    DAI: { address: "0x6B175474E89094C44Da98b974dEAc2d99F9f728", decimals: 18 },
  },
  base: {
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  },
  poly: {
    USDC: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    USDT: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
  },
  "arb-one": {
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
  },
  opt: {
    USDC: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    USDT: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
  },
};

export function formatKnownTokensForPrompt(): string {
  const lines: string[] = [];
  for (const [chain, tokens] of Object.entries(KNOWN_TOKENS)) {
    for (const [symbol, info] of Object.entries(tokens)) {
      lines.push(`- ${symbol} on ${chain}: ${info.address} (${info.decimals} decimals)`);
    }
  }
  return lines.join("\n");
}
