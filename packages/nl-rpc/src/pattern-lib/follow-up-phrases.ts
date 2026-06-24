import { normalizeQuery } from "./normalize.js";

/** Vague conversational follow-up stems (not domain-specific). */
const VAGUE_FOLLOW_UP_STEMS = [
  /\bhow\s+about\b/i,
  /\bwhat\s+about\b/i,
  /\band\s+for\b/i,
  /\band\s+what\s+about\b/i,
  /\bsame\s+for\b/i,
  /\bnow\s+for\b/i,
  /\binstead\b/i,
  /\bcompare\s+that\b/i,
  /\bhow\s+about\s+in\b/i,
  /\bwhat\s+about\s+in\b/i,
];

/** Short queries with only a time phrase (no asset). */
const TIME_ONLY_FOLLOW_UP =
  /\b(?:in\s+(?:\d+|a|one)\s+weeks?|in\s+(?:\d+|a|one)\s+months?|in\s+(?:\d+|a|one)\s+years?|in\s+\d+\s+(?:hours?|days?)|for\s+(?:the\s+)?week|over\s+(?:the\s+)?(?:last|past)\s+week|last\s+week|past\s+week|the\s+week|7\s*days?|in\s+a\s+month|for\s+(?:the\s+)?month|last\s+month|past\s+month|the\s+month|30\s*days?|24\s*h(?:rs?|ours?)?|24h|last\s+day|yesterday)\b/i;

/** Temporal / metric follow-ups (gas, balance, block history). */
const TEMPORAL_FOLLOW_UP =
  /\b(what\s+was\s+it|what\s+about\s+it|how\s+about\s+(?:then|it|that)|and\s+(?:then|what\s+about|earlier)|back\s+then|at\s+that\s+time|and\s+yesterday|and\s+last\s+week)\b/i;

/** Swap status follow-up phrases. */
export const SWAP_STATUS_PATTERNS = [
  /\b(did|was|has|have)\s+(?:that|the|my|it)\s+swap\b/i,
  /\b(?:swap|trade)\s+(?:status|succeed(?:ed)?|successful|complete(?:d)?|done|fail(?:ed)?|go through|fill(?:ed)?)\b/i,
  /\bdid\s+(?:that|it|the swap)\s+(?:work|succeed|go through|complete|fill)\b/i,
  /\b(?:check|what(?:'s| is))\s+(?:the\s+)?swap\s+status\b/i,
  /\b(?:is|was)\s+(?:my|the|that)\s+swap\s+(?:done|complete|successful|filled|pending)\b/i,
  /\b(?:is\s+it\s+done|any\s+update|still\s+pending|where(?:'s| is)\s+my\s+swap|order\s+status)\b/i,
  /\bdid\s+it\s+fill\b/i,
];

/** Send / transfer status follow-up phrases. */
export const SEND_STATUS_PATTERNS = [
  /\b(did|was|has|have)\s+(?:that|the|my|it)\s+(?:send|transfer|transaction|tx|payment)\b/i,
  /\b(?:send|transfer|transaction|tx|payment)\s+(?:status|succeed(?:ed)?|successful|complete(?:d)?|done|fail(?:ed)?|go through|confirm(?:ed)?|mined|land(?:ed)?)\b/i,
  /\bdid\s+(?:that|it|the)\s+(?:send|transfer|payment|transaction|tx)\s+(?:work|succeed|go through|complete|confirm|land)\b/i,
  /\b(?:check|what(?:'s| is))\s+(?:the\s+)?(?:send|transfer|transaction|tx)\s+status\b/i,
  /\b(?:is|was)\s+(?:my|the|that)\s+(?:send|transfer|transaction|tx|payment)\s+(?:done|complete|successful|confirmed|mined|landed)\b/i,
  /\b(?:did\s+it\s+land|still\s+confirming|mined\s+yet|tx\s+stuck|payment\s+went\s+through|did\s+it\s+go\s+through)\b/i,
];

export function isVagueFollowUp(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (VAGUE_FOLLOW_UP_STEMS.some((p) => p.test(q))) return true;
  if (TIME_ONLY_FOLLOW_UP.test(q) && q.split(/\s+/).length <= 10) return true;
  return false;
}

export function isTemporalFollowUp(query: string): boolean {
  const q = normalizeQuery(query);
  if (TEMPORAL_FOLLOW_UP.test(q)) return true;
  if (isVagueFollowUp(query) && /\b(?:ago|yesterday|earlier|then|last\s+(?:hour|day|week))\b/i.test(q)) {
    return true;
  }
  return false;
}

export function isSwapStatusPhrase(query: string): boolean {
  const q = query.trim();
  if (/\bswap\b/i.test(q) && /\b(send|transfer)\b/i.test(q)) return false;
  if (!/\bswap\b/i.test(q) && isSendStatusPhrase(q)) return false;
  return SWAP_STATUS_PATTERNS.some((p) => p.test(q));
}

export function isSendStatusPhrase(query: string): boolean {
  const q = query.trim();
  if (/\bswap\b/i.test(q)) return false;
  return SEND_STATUS_PATTERNS.some((p) => p.test(q));
}

/** Follow-up disputing empty transfer results or asking to recheck token activity. */
const TRANSFER_DISPUTE_PATTERNS = [
  /\b(?:i(?:'?ve| have)?)\s+received\b/i,
  /\bive\s+received\b/i,
  /\breceived\s+(?:some\s+)?tokens?\b/i,
  /\b(?:but|however)\b.*\breceived\b/i,
  /\b(?:did|do)\s+(?:receive|get)\b.*\btokens?\b/i,
  /\b(?:look|search|check)\s+(?:further|deeper|more|all|full|complete|again)\b/i,
  /\b(?:that(?:'s| is)\s+)?(?:wrong|incorrect|not\s+right)\b/i,
  /\b(?:no|not)\s+(?:correct|true|right)\b/i,
  /\b(?:any|some)\s+tokens?\b/i,
];

export function isTransferDisputeFollowUp(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  return TRANSFER_DISPUTE_PATTERNS.some((p) => p.test(q));
}

/** Vague follow-up that should route to status when session has swap/send context. */
export function isVagueStatusFollowUp(query: string): boolean {
  const q = query.trim();
  if (isSendStatusPhrase(q) || isSwapStatusPhrase(q)) return true;
  if (!isVagueFollowUp(query)) return false;
  return /\b(?:done|through|status|update|pending|confirm|mined|land|fill|succeed|work)\b/i.test(q);
}
