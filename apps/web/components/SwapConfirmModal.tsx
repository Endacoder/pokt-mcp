"use client";

import { useEffect, useState } from "react";
import {
  prepareSwap,
  fetchQuoteConfirmation,
  submitSwap,
  syncPermitSwap,
  pollSwapStatus,
  isSwapCompleted,
  isSwapFailed,
  SwapApiError,
  fetchSwapInstructions,
  isInsufficientAllowanceError,
  assertSinglePermittedAccount,
  isWalletAccountMismatchError,
  type SwapQuoteDisplay,
  type SigningInstructions,
} from "../lib/swap-api";
import {
  hasPendingApprovalTransaction,
  resolveSwapSigningStep,
  signQuoteConfirmationMessage,
  signSwapSignStep,
  resolvePermit2SubmitWallet,
  lastPermit2PayloadFromInstructions,
  type SwapSigningStepKind,
} from "../lib/swap-sign";
import { getAddress } from "viem";
import { ensureWalletNetworkForSwap, pocketRpcSetupHint } from "../lib/wallet-network";
import { listPermittedAccounts, refreshConnectedWallet } from "../lib/wallet-connect";
import { resolveWalletProvider } from "../lib/wallet-provider";
import { isQuoteExpired } from "../lib/swap-expiry";
import { quoteRequiresGasAck } from "@pokt-mcp/shared/swap-gas-routing";

type Phase = "confirm" | "confirm-requote" | "preparing" | "signing" | "submitting" | "settling" | "done" | "error";

export function SwapConfirmModal({
  display,
  quoteId,
  apiUrl,
  walletAddress,
  chainId,
  onClose,
  onComplete,
  onPhaseChange,
}: {
  display: SwapQuoteDisplay;
  quoteId: string;
  apiUrl: string;
  walletAddress?: string;
  chainId?: number;
  onClose: () => void;
  onComplete: (result: { txHash?: string; status?: string; intentId?: string }) => void;
  onPhaseChange?: (phase: Phase) => void;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<string>();
  const [signStepKind, setSignStepKind] = useState<SwapSigningStepKind | "quote_confirmation">("quote_confirmation");
  const [signStep, setSignStep] = useState(0);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [finalStatus, setFinalStatus] = useState<string>();
  const [requoteNote, setRequoteNote] = useState<string>();
  const [activeQuoteId, setActiveQuoteId] = useState(quoteId);
  const [activeExpiresAt, setActiveExpiresAt] = useState(display.expiresAt);
  const [requoteExecutionMode, setRequoteExecutionMode] = useState<string | undefined>(
    display.executionMode,
  );
  const [permittedAccounts, setPermittedAccounts] = useState<string[]>([]);
  const quoteExpired = isQuoteExpired(activeExpiresAt);
  const canRetry =
    phase === "confirm" || phase === "confirm-requote" || (phase === "error" && error !== "expired");
  const needsGasRpc =
    requoteExecutionMode === "gas" ||
    display.executionMode === "gas" ||
    (requoteExecutionMode !== "gasless" && display.tokenIn !== "ETH");
  const requiresGasAck = quoteRequiresGasAck({
    executionMode: requoteExecutionMode ?? display.executionMode,
    route: display.route,
    routeType: display.routeType,
    gasless: display.gasless,
    gasEstimateUsd: display.gasEstimateUsd,
  });

  function setSwapPhase(next: Phase) {
    setPhase(next);
    onPhaseChange?.(next);
  }

  useEffect(() => {
    const provider = resolveWalletProvider();
    if (!provider || !walletAddress) {
      setPermittedAccounts([]);
      return;
    }
    void listPermittedAccounts(provider).then(setPermittedAccounts).catch(() => setPermittedAccounts([]));
  }, [walletAddress]);

  async function handleConfirm() {
    const provider = resolveWalletProvider();
    if (!walletAddress || !provider) {
      setError("Connect your wallet before confirming a swap.");
      setSwapPhase("error");
      return;
    }

    if (isQuoteExpired(activeExpiresAt)) {
      setError("expired");
      setSwapPhase("error");
      return;
    }

    setError(undefined);
    setSwapPhase("preparing");

    let flowAccountChanged = false;
    const flowWallet = walletAddress;
    const onFlowAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      const next = accounts?.[0]?.trim();
      if (next && /^0x[a-fA-F0-9]{40}$/.test(next) && getAddress(next) !== getAddress(flowWallet)) {
        flowAccountChanged = true;
      }
    };
    provider.on?.("accountsChanged", onFlowAccountsChanged);

    function assertFlowWalletUnchanged(): void {
      if (flowAccountChanged) {
        throw new SwapApiError(
          "Wallet account changed during swap. Request a fresh quote with the account you want to use.",
          "WALLET_ACCOUNT_MISMATCH",
        );
      }
    }

    try {
      const providerAddress = await refreshConnectedWallet();
      if (
        providerAddress &&
        walletAddress &&
        getAddress(providerAddress) !== getAddress(walletAddress)
      ) {
        throw new SwapApiError(
          `MetaMask is on ${getAddress(providerAddress)} but your connected wallet is ${getAddress(walletAddress)}. ` +
            "Switch MetaMask to your connected wallet before confirming, or Disconnect and Connect Wallet again.",
          "WALLET_ACCOUNT_MISMATCH",
        );
      }

      const activeWallet = await assertSinglePermittedAccount(
        providerAddress ?? walletAddress,
      );

      if (chainId != null) {
        const hexChain = `0x${chainId.toString(16)}`;
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: hexChain }],
          });
        } catch {
          /* user may already be on chain */
        }
        await ensureWalletNetworkForSwap(provider, chainId);
      }

      const expectedQuote =
        display.chainId &&
        display.tokenInAddress &&
        display.tokenOutAddress &&
        display.amountInAtomic
          ? {
              tokenInAddress: display.tokenInAddress,
              tokenOutAddress: display.tokenOutAddress,
              amountInAtomic: display.amountInAtomic,
              chainId: display.chainId,
            }
          : undefined;

      const expectedPermit = expectedQuote
        ? { tokenAddress: expectedQuote.tokenInAddress, amountAtomic: expectedQuote.amountInAtomic }
        : undefined;

      const metadata = {
        tokenIn: display.tokenIn,
        tokenOut: display.tokenOut,
        amountIn: display.amountIn,
        chainName: display.chainName,
      };

      let intentId = "";
      let instructions: SigningInstructions | null = null;
      const maxSignSteps = 4;

      let quoteIdForPrepare = activeQuoteId;
      let executionModeForRequote = requoteExecutionMode ?? display.executionMode;

      function buildRequoteParams() {
        if (
          !display.chainId ||
          !display.tokenInAddress ||
          !display.tokenOutAddress ||
          !display.amountInAtomic
        ) {
          return undefined;
        }
        return {
          fromChain: display.chainId,
          toChain: display.chainId,
          tokenIn: display.tokenInAddress,
          tokenOut: display.tokenOutAddress,
          amount: display.amountInAtomic,
          slippageBps: 300,
          executionMode:
            executionModeForRequote === "gasless" ? ("gasless" as const) : ("any" as const),
        };
      }

      let permitSigner: string | undefined;
      const maxPrepareAttempts = 3;
      for (let prepareAttempt = 0; prepareAttempt < maxPrepareAttempts; prepareAttempt++) {
        const confirmation = await fetchQuoteConfirmation(apiUrl, quoteIdForPrepare, activeWallet);
        setSignStepKind("quote_confirmation");
        setSignStep(0);
        setSwapPhase("signing");
        const confirmationSignature = await signQuoteConfirmationMessage(
          confirmation.message,
          activeWallet,
          chainId ?? display.chainId,
        );

        setSwapPhase("preparing");
        const prepared = await prepareSwap(
          apiUrl,
          quoteIdForPrepare,
          activeWallet,
          expectedQuote,
          buildRequoteParams(),
          confirmationSignature,
          {
            acknowledgeUserPaidGas: requiresGasAck,
            quoteExecutionMode: requoteExecutionMode ?? display.executionMode,
            quoteRoute: display.route,
            quoteRouteType: display.routeType,
            quoteGasEstimateUsd: display.gasEstimateUsd,
            quoteGasless: display.gasless,
          },
        );
        if (prepared.requoteApplied && prepared.freshQuoteId) {
          quoteIdForPrepare = prepared.freshQuoteId;
          setActiveQuoteId(prepared.freshQuoteId);
          if (prepared.freshQuoteExpiresAt) {
            setActiveExpiresAt(prepared.freshQuoteExpiresAt);
          }
          if (prepared.freshExecutionMode) {
            executionModeForRequote = prepared.freshExecutionMode;
            setRequoteExecutionMode(prepared.freshExecutionMode);
          }
          setRequoteNote(prepared.requoteNote);
          if (prepareAttempt + 1 >= maxPrepareAttempts) {
            setSwapPhase("confirm-requote");
            return;
          }
          continue;
        }
        if (!prepared.intentId || !prepared.signingInstructions) {
          throw new Error("Invalid prepare response from server");
        }
        intentId = prepared.intentId;
        instructions = prepared.signingInstructions;
        break;
      }

      if (!instructions) {
        throw new Error("Could not prepare swap after re-quote attempts");
      }

      for (let step = 0; step < maxSignSteps; step++) {
        const nextStep = resolveSwapSigningStep(instructions, expectedQuote?.tokenInAddress);
        setSignStepKind(nextStep);
        setNeedsApproval(nextStep === "token_approval");
        setSignStep(step + 1);
        setSwapPhase("signing");
        assertFlowWalletUnchanged();
        const signingWallet =
          nextStep === "transaction" && permitSigner ? permitSigner : activeWallet;
        if (nextStep === "transaction" && permitSigner) {
          await assertSinglePermittedAccount(permitSigner);
        } else {
          await assertSinglePermittedAccount(activeWallet);
        }
        const signResult = await signSwapSignStep(
          instructions,
          signingWallet,
          expectedQuote,
          chainId ?? display.chainId,
          apiUrl,
        );

        setSwapPhase("submitting");
        assertFlowWalletUnchanged();
        const liveWallet = permitSigner ?? (await assertSinglePermittedAccount(activeWallet));
        const submitValue = signResult.value;
        const submitTxHash = signResult.kind === "tx_hash" ? signResult.value : undefined;
        let submitWalletAddress = liveWallet;
        let result;
        if (signResult.kind === "signature") {
          const permitPayload = lastPermit2PayloadFromInstructions(instructions);
          if (permitPayload != null) {
            const resolved = await resolvePermit2SubmitWallet(
              permitPayload,
              signResult.value,
              activeWallet,
              signResult.signedTypedData,
            );
            submitWalletAddress = resolved.submitWallet;
            if (resolved.corrected) {
              const syncResult = await syncPermitSwap(
                apiUrl,
                intentId,
                signResult.value,
                resolved.submitWallet,
              );
              permitSigner = syncResult.permitSigner ?? resolved.recoveredSigner;
              if (syncResult.pendingMoreSignatures) {
                instructions =
                  (await fetchSwapInstructions(apiUrl, intentId)).signingInstructions ?? instructions;
                continue;
              }
              result = {
                intentId: syncResult.intentId,
                status: syncResult.status,
                txHash: syncResult.txHash,
                pendingMoreSignatures: false,
              };
            }
          }
        }
        if (!result) {
          try {
            result = await submitSwap(
              apiUrl,
              intentId,
              submitValue,
              submitWalletAddress,
              metadata,
              submitTxHash,
            );
          } catch (submitErr) {
            if (isInsufficientAllowanceError(submitErr) && intentId && step < maxSignSteps - 1) {
              instructions =
                (await fetchSwapInstructions(apiUrl, intentId)).signingInstructions ?? instructions;
              setNeedsApproval(hasPendingApprovalTransaction(instructions, expectedPermit));
              continue;
            }
            throw submitErr;
          }
        }
        intentId = result.intentId;

        if (result.pendingMoreSignatures && result.signingInstructions) {
          instructions = result.signingInstructions;
          continue;
        }

        if (signResult.kind === "tx_hash" && nextStep === "token_approval") {
          const refreshed =
            result.signingInstructions ??
            (await fetchSwapInstructions(apiUrl, intentId)).signingInstructions;
          try {
            const followUp = resolveSwapSigningStep(refreshed, expectedQuote?.tokenInAddress);
            if (followUp === "permit2" || followUp === "typed_data" || followUp === "transaction") {
              instructions = refreshed;
              continue;
            }
          } catch {
            /* no further wallet steps */
          }
        }

        if (result.pendingMoreSignatures) {
          continue;
        }

        setSwapPhase("settling");
        const polled = await pollSwapStatus(apiUrl, intentId);
        setFinalStatus(polled.status);
        setTxHash(polled.txHash ?? result.txHash);

        if (isSwapFailed(polled.status)) {
          throw new SwapApiError(
            polled.error
              ? `Swap failed: ${polled.error}`
              : `Swap failed with status: ${polled.status ?? "unknown"}`,
          );
        }

        if (!isSwapCompleted(polled.status) && !polled.txHash && !result.txHash) {
          setFinalStatus(polled.status ?? result.status ?? "submitted");
        }

        setSwapPhase("done");
        onComplete({
          txHash: polled.txHash ?? result.txHash,
          status: polled.status ?? result.status,
          intentId,
        });
        return;
      }

      throw new Error("Swap required too many wallet signatures — request a new quote.");
    } catch (err) {
      const rejected =
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: number }).code === 4001;
      if (rejected) {
        setError(
          err instanceof Error && /transaction cancelled/i.test(err.message)
            ? "Wallet approval cancelled. Approve the Permit2 transaction to continue, or choose Gasless / Best price to skip on-chain approval."
            : "Wallet signature cancelled. You can try again while the quote is still valid.",
        );
      } else if (err instanceof SwapApiError && err.code === "SIMULATION_FAILED") {
        setError(
          /TRANSFER_FROM_FAILED/i.test(err.message)
            ? "This swap couldn't be simulated — the router couldn't pull your input token. Confirm your wallet holds enough of the token you're selling. Try Gasless or Best price in Settings → Swap execution, then request a fresh quote."
            : err.message,
        );
      } else if (err instanceof SwapApiError && err.code === "CONFIRMATION_REQUIRED") {
        setError(
          "Quote authorization signature required. Try again — your wallet should prompt for a short confirmation message first.",
        );
      } else if (err instanceof SwapApiError && err.code === "SIGNING_PAYLOAD_UNAVAILABLE") {
        setError(
          "Could not build wallet signing data for this route. Close this dialog, request a new quote, and confirm within 60 seconds. If it persists, try Best price or Gasless execution mode.",
        );
      } else if (err instanceof SwapApiError && err.code === "QUOTE_EXPIRED") {
        setError("expired");
      } else if (err instanceof SwapApiError && err.code === "ROUTE_BUILD_FAILED") {
        setError(
          `${err.message} Request a fresh swap quote with your wallet connected first.`,
        );
      } else if (err instanceof SwapApiError && err.code === "PERMIT_AMOUNT_MISMATCH") {
        setError(`${err.message} Request a new quote — do not approve the wallet prompt.`);
      } else if (err instanceof SwapApiError && err.code === "ORDER_QUOTE_MISMATCH") {
        setError(`${err.message} Request a new quote — do not sign the wallet prompt.`);
      } else if (
        err instanceof SwapApiError &&
        (err.code === "WALLET_ACCOUNT_MISMATCH" || isWalletAccountMismatchError(err))
      ) {
        setError(err.message);
      } else if (err instanceof SwapApiError && err.code === "INVALID_SWAP_SIGNATURE") {
        setError(
          /Permit2 signature does not match/i.test(err.message)
            ? `${err.message} Close this dialog, request a new quote, then sign in order: (1) quote authorization message, (2) Permit2 EIP-712 swap prompt — not the ERC20 approval transaction.`
            : err.message,
        );
      } else if (
        err instanceof Error &&
        /does not match the swap order account/i.test(err.message)
      ) {
        setError(err.message);
      } else if (
        err instanceof Error &&
        (/wallet's network RPC returned HTTP 403/i.test(err.message) ||
          /RPC endpoint returned HTTP client error/i.test(err.message))
      ) {
        setError(`${err.message} ${pocketRpcSetupHint(chainId ?? display.chainId)}`);
      } else if (
        err instanceof Error &&
        /must be approved for Permit2 before Uniswap/i.test(err.message)
      ) {
        setError(err.message);
      } else if (err instanceof SwapApiError && err.code === "WALLET_ACCOUNT_MISMATCH") {
        setError(err.message);
      } else if (err instanceof SwapApiError && err.code === "WALLET_NOT_CONNECTED") {
        setError(err.message);
      } else if (isInsufficientAllowanceError(err)) {
        setError(
          "Token approval to Permit2 may not have completed. Try again — your wallet should prompt for an approval transaction, then the swap signature.",
        );
      } else if (err instanceof SwapApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setSwapPhase("error");
    } finally {
      provider.removeListener?.("accountsChanged", onFlowAccountsChanged);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-2xl border border-pocket-border bg-pocket-surface p-5 shadow-xl"
        role="dialog"
        aria-labelledby="swap-confirm-title"
      >
        <h2 id="swap-confirm-title" className="text-lg font-semibold text-pocket-foreground">
          Confirm swap
        </h2>
        <p className="mt-2 text-sm text-pocket-muted">{display.chainName}</p>
        <p className="mt-1 text-xl font-semibold text-pocket-foreground">
          {display.amountIn} {display.tokenIn}
          <span className="mx-2 font-normal text-pocket-muted">→</span>
          ~{display.amountOut} {display.tokenOut}
        </p>

        {walletAddress && (phase === "confirm" || phase === "confirm-requote") && (
          <div className="mt-3 rounded-lg border border-pocket-border bg-pocket-elevated/40 px-3 py-2 text-xs text-pocket-muted">
            <p>
              <span className="font-medium text-pocket-foreground">Connected wallet</span>{" "}
              <span className="font-mono">{walletAddress}</span>
            </p>
            <p className="mt-1">
              All signatures must come from this account only. In each MetaMask popup, confirm the account
              matches before you approve.
            </p>
            {permittedAccounts.length > 1 && (
              <p className="mt-1 text-amber-800 dark:text-amber-200">
                MetaMask has {permittedAccounts.length} accounts authorized ({permittedAccounts
                  .map((a) => `${a.slice(0, 6)}…${a.slice(-4)}`)
                  .join(", ")}
                ). Disconnect this site in MetaMask and reconnect with only{" "}
                {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}.
              </p>
            )}
          </div>
        )}

        {phase === "confirm" && !quoteExpired && (
          <>
            <p className="mt-3 text-sm text-pocket-muted">
              Typical gas swap: (1) quote authorization signature, (2) one USDC approval for exactly this
              swap amount to Permit2, (3) Permit2 EIP-712 signature. Use Settings → Gasless to skip on-chain
              approvals when available.
            </p>
            <p className="mt-2 text-sm text-pocket-muted">
              Step 1: your wallet will ask you to sign a short quote authorization (no gas). Then you may approve and sign the swap.
            </p>
            {requiresGasAck && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                This route requires you to pay network gas. You will confirm the swap in your wallet and
                may need to approve {display.tokenIn} for Permit2 first.
                {" "}
                {pocketRpcSetupHint(chainId ?? display.chainId)}
              </p>
            )}
            {needsGasRpc && !requiresGasAck && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                This swap may use an on-chain route. Your wallet may ask for two steps: approve {display.tokenIn} for
                Permit2, then confirm the swap.
                {" "}
                {pocketRpcSetupHint(chainId ?? display.chainId)}
              </p>
            )}
          </>
        )}
        {quoteExpired && (
          <p className="mt-3 text-sm text-red-600">
            This quote has expired. Close and request a new swap quote.
          </p>
        )}

        {phase === "confirm-requote" && (
          <>
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              {requoteNote ??
                "The original route could not be built. A fresh route was prepared — review amounts before continuing."}
            </p>
            <p className="mt-2 text-sm text-pocket-muted">
              You will still swap {display.amountIn} {display.tokenIn} → ~{display.amountOut}{" "}
              {display.tokenOut}. Amounts may differ slightly on the new route. Click{" "}
              <strong>Authorize new quote</strong> below — your wallet will ask for (1) quote
              authorization, then (2) Permit2 signature.
            </p>
          </>
        )}
        {phase === "preparing" && (
          <>
            <p className="mt-3 text-sm text-pocket-accent">Preparing intent with Intent MCP…</p>
            {requoteNote && (
              <p className="mt-2 text-xs text-pocket-muted">{requoteNote}</p>
            )}
          </>
        )}
        {phase === "signing" && signStepKind === "quote_confirmation" && (
          <p className="mt-3 text-sm text-pocket-accent">
            Step 1 — Check your wallet to authorize this quote (personal_sign — does not execute a swap).
          </p>
        )}
        {phase === "signing" && signStepKind === "token_approval" && (
          <p className="mt-3 text-sm text-pocket-accent">
            Step {signStep} — Confirm the ERC20 approval transaction in MetaMask (pays gas). This is not the Permit2 signature.
          </p>
        )}
        {phase === "signing" && (signStepKind === "permit2" || signStepKind === "typed_data") && (
          <p className="mt-3 text-sm text-pocket-accent">
            Step {signStep} — Sign the account verification message, then Permit2 typed data (no gas).
            Use the same account (
            <span className="font-mono">{walletAddress?.slice(0, 6)}…{walletAddress?.slice(-4)}</span>
            ) for both prompts. MetaMask may only ask to reconnect if multiple accounts are authorized.
          </p>
        )}
        {phase === "signing" && signStepKind === "transaction" && (
          <p className="mt-3 text-sm text-pocket-accent">
            Step {signStep} — Confirm the swap transaction in MetaMask.
          </p>
        )}
        {phase === "signing" &&
          signStepKind !== "quote_confirmation" &&
          signStepKind !== "token_approval" &&
          signStepKind !== "permit2" &&
          signStepKind !== "typed_data" &&
          signStepKind !== "transaction" &&
          signStep > 0 && (
          <p className="mt-3 text-sm text-pocket-accent">
            {needsApproval
              ? needsGasRpc
                ? "Approve exactly this swap's USDC amount for Permit2 (not unlimited), then sign Permit2."
                : "Step 1: approve the token for swapping in your wallet (one-time Permit2 approval). Then you'll sign the swap."
              : signStep > 1
                ? `Step ${signStep}: additional signature required — check your wallet.`
                : "Check your wallet to sign the swap…"}
          </p>
        )}
        {phase === "signing" && signStepKind !== "quote_confirmation" && walletAddress && (
          <p className="mt-2 text-xs text-pocket-muted">
            Only sign if the account shown is{" "}
            <span className="font-mono">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</span>
            {" "}— cancel and reconnect if MetaMask shows a different account.
          </p>
        )}
        {phase === "submitting" && (
          <p className="mt-3 text-sm text-pocket-accent">Submitting signed intent…</p>
        )}
        {phase === "settling" && (
          <p className="mt-3 text-sm text-pocket-accent">
            Waiting for relayer/filler to execute the swap…
          </p>
        )}
        {phase === "done" && (
          <p className="mt-3 text-sm text-green-700">
            {isSwapCompleted(finalStatus)
              ? "Swap completed"
              : finalStatus
                ? `Swap submitted (${finalStatus})`
                : "Swap submitted"}
            {txHash && isSwapCompleted(finalStatus)
              ? `: ${txHash.slice(0, 10)}…${txHash.slice(-8)}`
              : ""}
            {!isSwapCompleted(finalStatus) && (
              <span className="mt-1 block text-pocket-muted">
                {finalStatus === "failed"
                  ? "The relayer could not fill this order. Try Gas mode or swap on Base."
                  : "Gasless swaps may take a minute to fill. Ask \"did that swap succeed?\" to check status."}
              </span>
            )}
          </p>
        )}
        {phase === "error" && error && error !== "expired" && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
        {phase === "error" && error === "expired" && (
          <p className="mt-3 text-sm text-red-600">
            This quote expired (~60s limit). Close this dialog, request a fresh swap quote, and confirm
            immediately.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-pocket-border px-3 py-2 text-sm text-pocket-muted transition-colors hover:bg-pocket-elevated"
            onClick={onClose}
            disabled={phase === "preparing" || phase === "signing" || phase === "submitting" || phase === "settling"}
          >
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {canRetry && !quoteExpired ? (
            <button
              type="button"
              className="rounded-lg bg-pocket-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-pocket-cta-hover disabled:opacity-50"
              disabled={!walletAddress}
              onClick={handleConfirm}
            >
              {phase === "confirm-requote"
                ? "Authorize new quote"
                : phase === "error"
                  ? "Try again"
                  : "Sign in wallet"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
