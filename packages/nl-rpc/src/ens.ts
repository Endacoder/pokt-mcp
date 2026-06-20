import { encodeFunctionData, type Address } from "viem";
import { namehash } from "viem/ens";
import type { PocketClient } from "@pokt-mcp/pocket-client";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as Address;

const registryAbi = [
  {
    name: "resolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const resolverAbi = [
  {
    name: "addr",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export async function resolveEnsAddress(pocket: PocketClient, ensName: string): Promise<string> {
  const node = namehash(ensName);
  const resolverData = encodeFunctionData({
    abi: registryAbi,
    functionName: "resolver",
    args: [node],
  });

  const resolverResp = await pocket.rpc<string>("eth", "eth_call", [
    { to: ENS_REGISTRY, data: resolverData },
    "latest",
  ]);
  const resolverHex = resolverResp.result.replace(/^0x/, "").padStart(64, "0");
  const resolverAddr = `0x${resolverHex.slice(24)}`;
  if (resolverAddr === "0x0000000000000000000000000000000000000000") {
    throw new Error(`ENS name not found: ${ensName}`);
  }

  const addrData = encodeFunctionData({
    abi: resolverAbi,
    functionName: "addr",
    args: [node],
  });

  const addrResp = await pocket.rpc<string>("eth", "eth_call", [
    { to: resolverAddr, data: addrData },
    "latest",
  ]);
  const addrHex = addrResp.result.replace(/^0x/, "").padStart(64, "0");
  const address = `0x${addrHex.slice(24)}`;
  if (address === "0x0000000000000000000000000000000000000000") {
    throw new Error(`ENS name has no address record: ${ensName}`);
  }
  return address;
}

export async function getEnsBalance(pocket: PocketClient, ensName: string): Promise<unknown> {
  const address = await resolveEnsAddress(pocket, ensName);
  const balanceResp = await pocket.rpc<string>("eth", "eth_getBalance", [address, "latest"]);
  return {
    ens: ensName,
    address,
    balance: balanceResp.result,
    chain: "eth",
  };
}
