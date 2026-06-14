export function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true as const } : {}),
  };
}

export function chainNotFound(chain: string) {
  return textResult({ error: `CHAIN_NOT_FOUND: ${chain}` }, true);
}
