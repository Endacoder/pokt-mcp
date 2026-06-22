/** Client-side mirror of FEATURE_THINKING (baked at build time). Default: off. */
export function isThinkingEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_FEATURE_THINKING;
  return flag === "true" || flag === "1";
}
