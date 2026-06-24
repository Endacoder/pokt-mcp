import { normalizeQuery } from "./normalize.js";

const TIME_OFFSET =
  /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mo)\s+ago\b/i;

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
  w: 604800,
  week: 604800,
  weeks: 604800,
  mo: 2592000,
  month: 2592000,
  months: 2592000,
};

/** Point-in-time offset for chain RPC historical queries (seconds in the past). */
export function parseTimeOffsetSeconds(query: string): number | null {
  const q = normalizeQuery(query);
  if (/\byesterday\b/.test(q)) return 86_400;
  if (/\blast\s+hour\b/.test(q)) return 3_600;
  if (/\blast\s+day\b/.test(q)) return 86_400;
  if (/\blast\s+week\b/.test(q)) return 604_800;
  if (/\ban?\s+hour\s+ago\b/.test(q)) return 3_600;
  if (/\ban?\s+day\s+ago\b/.test(q)) return 86_400;
  if (/\ban?\s+week\s+ago\b/.test(q)) return 604_800;

  const match = q.match(TIME_OFFSET);
  if (!match) return null;

  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unitKey = match[2].toLowerCase().replace(/s$/, "");
  const seconds = UNIT_SECONDS[unitKey] ?? UNIT_SECONDS[`${unitKey}s`];
  if (!seconds) return null;

  return Math.round(amount * seconds);
}

export function formatTimeOffsetLabel(seconds: number): string {
  if (seconds % 86_400 === 0 && seconds >= 86_400) {
    const days = seconds / 86_400;
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (seconds % 3_600 === 0 && seconds >= 3_600) {
    const hours = seconds / 3_600;
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  return seconds === 1 ? "1 second ago" : `${seconds} seconds ago`;
}
