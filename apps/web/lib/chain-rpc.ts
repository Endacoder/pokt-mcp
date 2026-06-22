import { postRpc } from "./api";
import { slugFromChainId } from "./chain-config";

export async function chainRpcCall(
  apiUrl: string,
  chainId: number,
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  const chain = slugFromChainId(chainId);
  if (!chain) {
    throw new Error(`Unsupported chain ID ${chainId} for RPC read`);
  }
  const { result, error } = await postRpc(apiUrl, { chain, method, params });
  if (error) throw new Error(error);
  return result;
}
