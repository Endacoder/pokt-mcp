import {
  DEFAULT_MAX_SEND_VALUE_ETH,
  isWriteRpcMethod,
  parseAllowedChains,
  parseMethodDenylist,
} from "@pokt-mcp/shared";

export interface AgentPolicyConfig {
  maxSendValueEth: number;
  allowedChains: Set<string>;
  methodDenylist: Set<string>;
}

export function loadAgentPolicyConfig(): AgentPolicyConfig {
  const allowed = parseAllowedChains();
  return {
    maxSendValueEth: parseFloat(process.env.MAX_SEND_VALUE_ETH ?? String(DEFAULT_MAX_SEND_VALUE_ETH)),
    allowedChains: new Set(allowed),
    methodDenylist: new Set(parseMethodDenylist()),
  };
}

export function assertAgentMethodAllowed(config: AgentPolicyConfig, method: string): void {
  if (config.methodDenylist.has(method)) {
    throw new Error(`POLICY_DENIED: method "${method}" is not allowed`);
  }
}

export function isAgentWriteMethod(method: string): boolean {
  return isWriteRpcMethod(method);
}
