import {
  recoverTypedSignature,
  SignTypedDataVersion,
  type MessageTypes,
  type TypedMessage,
} from "@metamask/eth-sig-util";
import { getAddress } from "viem";
import type { WalletTypedDataPayload } from "./typed-data-wallet";

/** Recover signer the same way MetaMask eth_signTypedData_v4 does (viem differs on PermitSingle). */
export function recoverMetaMaskTypedDataSigner(
  typedData: WalletTypedDataPayload,
  signature: string,
): string {
  return getAddress(
    recoverTypedSignature({
      data: typedData as TypedMessage<MessageTypes>,
      signature,
      version: SignTypedDataVersion.V4,
    }),
  );
}

export function verifyMetaMaskTypedDataSigner(
  typedData: WalletTypedDataPayload,
  signature: string,
  expectedWallet: string,
): boolean {
  try {
    return recoverMetaMaskTypedDataSigner(typedData, signature) === getAddress(expectedWallet);
  } catch {
    return false;
  }
}
