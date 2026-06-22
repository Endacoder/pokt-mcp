import type { SwapQuoteDisplay } from "./swap-api";

export type SwapPhase =
  | "quoted"
  | "confirm"
  | "confirm-requote"
  | "preparing"
  | "signing"
  | "submitting"
  | "settling"
  | "done"
  | "error";

export type SwapFlowState = {
  phase: SwapPhase;
  display: SwapQuoteDisplay;
  quoteId: string;
  txHash?: string;
  error?: string;
};

export const SWAP_STEPS = [
  { id: "quote", label: "Quote" },
  { id: "prepare", label: "Prepare" },
  { id: "sign", label: "Sign" },
  { id: "submit", label: "Submit" },
] as const;

export function swapStepIndex(phase: SwapPhase): number {
  switch (phase) {
    case "quoted":
    case "confirm":
    case "confirm-requote":
      return 0;
    case "preparing":
      return 1;
    case "signing":
      return 2;
    case "submitting":
      return 3;
    case "settling":
      return 3;
    case "done":
      return 4;
    case "error":
      return -1;
    default:
      return 0;
  }
}

export function swapPhaseMessage(phase: SwapPhase, error?: string): string {
  switch (phase) {
    case "quoted":
      return "Swap quote ready — confirm to sign in wallet.";
    case "confirm":
      return "Review the swap and sign in your wallet.";
    case "confirm-requote":
      return "Route was refreshed — review amounts before continuing.";
    case "preparing":
      return "Preparing intent with Intent MCP…";
    case "signing":
      return "Check your wallet to sign the swap.";
    case "submitting":
      return "Submitting signed intent…";
    case "settling":
      return "Waiting for relayer to execute swap…";
    case "done":
      return "Swap submitted successfully.";
    case "error":
      return error ?? "Swap failed — try a new quote.";
    default:
      return "";
  }
}
