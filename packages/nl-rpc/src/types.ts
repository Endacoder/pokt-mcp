export type RiskLevel = "none" | "low" | "high";
export type RpcAction = "read" | "write";

export interface RpcIntent {
  action: RpcAction;
  chain: string;
  method: string;
  params: unknown[];
  humanSummary: string;
  riskLevel: RiskLevel;
}

export interface SessionContext {
  defaultChain?: string;
  connectedAddress?: string;
}

export interface NlParseResult {
  intent: RpcIntent;
  pendingAction?: "wallet_send_transaction" | "wallet_sign_message";
  requiresConfirmation: boolean;
}

export interface NlRpcEngine {
  parse(query: string, context?: SessionContext): Promise<NlParseResult>;
  explain(method: string, params: unknown[], chain: string): string;
}
