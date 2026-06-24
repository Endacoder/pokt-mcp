import { createNlRpcEngine, executeIntent } from "@pokt-mcp/nl-rpc";
import { createPocketClient } from "@pokt-mcp/pocket-client";
import type { ChatRequest, SessionContext } from "@pokt-mcp/shared";
import { prepareSanitizedQueryInput, requireSessionId } from "@pokt-mcp/shared";
import { collectRouteQueryResult, routeQuery } from "./query-router.js";
import type { AgentEvent } from "./types.js";

export type { AgentEvent } from "./types.js";
export { runAgentLoop, collectAgentLoopResult } from "./agent-loop.js";
export {
  isComplexQuery,
  isParseFailedError,
  isExecutionFailedError,
  isSwapQuery,
  shouldUseAgentFirst,
} from "./complexity.js";
export { isSwapStatusQuery, formatSwapStatusAnswer } from "./intent-swap-status.js";
export { isSendStatusQuery, formatSendStatusAnswer } from "./send-status.js";
export { routeQuery, collectRouteQueryResult } from "./query-router.js";
export type { QueryRoute, RouteQueryInput } from "./query-router.js";
export {
  prepareSwapForSigning,
  fetchQuoteConfirmation,
  submitSwapSignature,
  fetchSwapSigningInstructions,
  getSwapIntentStatus,
  pollSwapIntentStatus,
  syncPermitSignerForIntent,
} from "./intent-swap-execute.js";
export type { SwapPrepareResult, SwapSubmitResult, SwapStatusResult, QuoteConfirmationResult } from "./intent-swap-execute.js";
export type { SigningInstructions } from "./intent-swap-types.js";
export {
  isQuoteExpiredError,
  isConfirmationRequiredError,
  isRouteBuildError,
  isInsufficientAllowanceError,
  isSimulationTransferFailedError,
  isOneinchOrderBuildError,
  isOrderBuildError,
  isUserPaidGasRequiredError,
  isInvalidExecutionModeError,
  PermitAmountMismatchError,
  OrderQuoteMismatchError,
} from "./intent-swap-types.js";
export type { ExpectedSwapQuote } from "./intent-swap-types.js";
export {
  normalizeSwapSignature,
  isInvalidSignatureSubmitError,
  isWalletAccountMismatchError,
} from "./intent-swap-execute.js";
export type { SwapRequoteParams } from "./intent-swap-types.js";

const SYSTEM_PROMPT = `You are a blockchain assistant backed by Pocket Network MCP tools.
Never ask for private keys. For sends, always preview first and require explicit user confirmation.
Prefer pocket_query for natural language chain queries. Use explicit RPC only when needed.`;

const chatSessions = new Map<string, SessionContext>();

function sessionKey(input: ChatRequest): string {
  return requireSessionId(input.sessionId);
}

export function getChatSession(sessionId: string): SessionContext | undefined {
  return chatSessions.get(sessionId);
}

export function setChatSession(sessionId: string, context: SessionContext): void {
  chatSessions.set(sessionId, context);
}

export function createAgentOrchestrator() {
  const nlRpc = createNlRpcEngine();
  const pocket = createPocketClient();

  return {
    systemPrompt: SYSTEM_PROMPT,
    nlRpc,
    pocket,

    async *runChat(input: ChatRequest): AsyncGenerator<AgentEvent> {
      try {
        const sid = sessionKey(input);
        const sessionContext: SessionContext = {
          defaultChain: input.chain,
          connectedAddress: input.connectedAddress,
          swapExecutionMode: input.swapExecutionMode,
          ...chatSessions.get(sid),
        };
        if (input.connectedAddress) {
          sessionContext.connectedAddress = input.connectedAddress;
        }
        if (input.swapExecutionMode) {
          sessionContext.swapExecutionMode = input.swapExecutionMode;
        }

        const sanitized = prepareSanitizedQueryInput({
          query: input.message,
          history: input.history,
          sessionContext,
        });

        yield* routeQuery({
          query: sanitized.query,
          history: sanitized.history,
          sessionContext: sanitized.sessionContext ?? sessionContext,
          pocket,
          onSessionUpdate: (patch) => {
            chatSessions.set(sid, { ...chatSessions.get(sid), ...sessionContext, ...patch });
          },
        });
      } catch (err) {
        yield {
          type: "error",
          data: { message: err instanceof Error ? err.message : String(err) },
        };
        yield { type: "done", data: {} };
      }
    },
  };
}

// Re-export for MCP backward compat
export { executeIntent } from "@pokt-mcp/nl-rpc";
