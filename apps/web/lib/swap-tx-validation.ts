import { decodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { PERMIT2_ADDRESS } from "./permit2-approval";

export class SwapTxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwapTxValidationError";
  }
}

/** True when calldata decodes to ERC20 approve (any spender). */
export function isErc20ApproveTransaction(tx: Record<string, unknown>): boolean {
  if (typeof tx.data !== "string" || !tx.data.startsWith("0x")) return false;
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data as `0x${string}` });
    return decoded.functionName === "approve";
  } catch {
    return false;
  }
}

/** Only Permit2 approve on the quoted input token may be sent from Intent MCP instructions. */
export function validateSwapApprovalTransaction(
  tx: Record<string, unknown>,
  allowedTokenAddress: string,
): void {
  if (typeof tx.to !== "string") {
    throw new SwapTxValidationError("Swap transaction missing destination address.");
  }

  let token: Address;
  let allowed: Address;
  try {
    token = getAddress(tx.to);
    allowed = getAddress(allowedTokenAddress);
  } catch {
    throw new SwapTxValidationError("Swap transaction has invalid token address.");
  }

  if (token !== allowed) {
    throw new SwapTxValidationError(
      `Swap transaction targets ${token} but this quote is for ${allowed}. Do not approve — request a new quote.`,
    );
  }

  const value = tx.value;
  if (value != null && value !== "0x0" && value !== "0x" && value !== "0" && value !== 0) {
    throw new SwapTxValidationError("Swap approval must not transfer native currency.");
  }

  if (typeof tx.data !== "string" || !tx.data.startsWith("0x")) {
    throw new SwapTxValidationError("Swap transaction missing calldata.");
  }

  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data as `0x${string}` });
  } catch {
    throw new SwapTxValidationError(
      "Swap transaction is not a standard ERC20 approve — request a new quote.",
    );
  }

  if (decoded.functionName !== "approve") {
    throw new SwapTxValidationError(
      `Unexpected swap transaction "${decoded.functionName}" — only ERC20 approve(Permit2) is allowed.`,
    );
  }

  const [spender] = decoded.args as readonly [Address, bigint];
  if (getAddress(spender) !== PERMIT2_ADDRESS) {
    throw new SwapTxValidationError(
      `Swap approval must be for Permit2 (${PERMIT2_ADDRESS}), not ${spender}.`,
    );
  }
}

/** True when tx is ERC20 approve(Permit2) on the quoted input token. */
export function isQuotedPermit2ApproveTx(
  tx: Record<string, unknown>,
  quotedTokenAddress: string,
): boolean {
  try {
    validateSwapApprovalTransaction(tx, quotedTokenAddress);
    return true;
  } catch {
    return false;
  }
}
