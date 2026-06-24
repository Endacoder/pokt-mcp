/** Show agent "thinking" status panel and stream intermediate status SSE events. Default: off. */
export function isThinkingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.FEATURE_THINKING ?? env.NEXT_PUBLIC_FEATURE_THINKING;
  return flag === "true" || flag === "1";
}
