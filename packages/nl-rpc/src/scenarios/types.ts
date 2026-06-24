import type { ChatHistoryMessage, SessionContext } from "@pokt-mcp/shared";

export type ParseScenario = {
  id: string;
  query: string;
  sessionContext?: SessionContext;
  turns?: ChatHistoryMessage[];
  expectMethod: string;
  expectParams?: unknown[];
  expectParamsPrefix?: unknown[];
  expectChain?: string;
};
