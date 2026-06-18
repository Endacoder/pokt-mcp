export type {
  NlParseResult,
  RiskLevel,
  RpcAction,
  RpcIntent,
  SessionContext,
} from "@pokt-mcp/shared";

export interface NlRpcEngine {
  parse(query: string, context?: import("@pokt-mcp/shared").SessionContext): Promise<import("@pokt-mcp/shared").NlParseResult>;
  explain(method: string, params: unknown[], chain: string): string;
}
