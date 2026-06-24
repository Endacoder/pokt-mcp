import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import {
  fetchActiveProposals,
  fetchProposalVotes,
  fetchRecentProposals,
  fetchVoterHistory,
  resolveSnapshotSpace,
  searchSpaces,
  type SnapshotProposal,
  type SnapshotVote,
} from "@pokt-mcp/integrations";
import { extractAddress, normalizeQuery } from "./patterns.js";

export type GovernanceResult = {
  mode: "proposals" | "votes" | "whales" | "voter_history";
  space?: string;
  spaceName?: string;
  proposals: SnapshotProposal[];
  votes: SnapshotVote[];
  voter?: string;
  dataSources: Record<string, "available" | "skipped" | "unavailable">;
  summary: string;
};

export function isGovernanceQuery(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\b(dao|governance|proposal|proposals|vote|voting)\b/.test(q) ||
    /\bactive\s+proposals?\b/.test(q) ||
    /\bwhale\s+vot(e|ing|es)\b/.test(q) ||
    /\bhow\s+did\b.*\bvote\b/.test(q)
  );
}

export function matchGovernanceQuery(query: string, _context?: SessionContext): RpcIntent | null {
  if (!isGovernanceQuery(query)) return null;

  let space = resolveSnapshotSpace(query);
  const q = normalizeQuery(query);

  const mode: GovernanceResult["mode"] =
    /\bwhale\b/.test(q) ? "whales" :
    /\bhow\s+did\b.*\bvote\b/.test(q) || extractAddress(query) ? "voter_history" :
    /\bvotes?\b/.test(q) && /\bproposal\b/.test(q) ? "whales" :
    "proposals";

  return {
    action: "read",
    chain: "eth",
    method: "__governance__",
    params: [query, space ?? "", mode],
    humanSummary: space ? `Governance for ${space}` : "DAO governance query",
    riskLevel: "none",
  };
}

export async function executeGovernance(
  query: string,
  spaceHint: string,
  mode: GovernanceResult["mode"],
): Promise<GovernanceResult> {
  const dataSources: GovernanceResult["dataSources"] = { snapshot: "available" };

  let space: string | undefined = spaceHint || resolveSnapshotSpace(query) || undefined;
  if (!space) {
    const daoMatch = query.match(/\b(uniswap|aave|compound|ens|lido|arbitrum|optimism|gitcoin|maker|curve)\b/i);
    if (daoMatch) {
      space = resolveSnapshotSpace(daoMatch[0]) ?? undefined;
    }
  }

  if (!space) {
    const searchTerm = query.match(/\b(?:for|on|in)\s+([a-z0-9.-]+)/i)?.[1];
    if (searchTerm) {
      const spaces = await searchSpaces(searchTerm, 1);
      space = spaces[0]?.id;
    }
  }

  const voter = extractAddress(query) ?? undefined;

  if (!space && mode === "proposals") {
    return {
      mode,
      proposals: [],
      votes: [],
      dataSources: { snapshot: "unavailable" },
      summary: "Could not resolve a Snapshot space — try 'active UNI proposals' or 'governance for aave'",
    };
  }

  try {
    if (mode === "voter_history" && voter) {
      const votes = await fetchVoterHistory(voter, 10);
      return {
        mode,
        space,
        voter,
        proposals: [],
        votes,
        dataSources,
        summary: `${votes.length} recent vote(s) by ${voter.slice(0, 10)}…`,
      };
    }

    const proposals =
      /\bactive\b/.test(normalizeQuery(query))
        ? await fetchActiveProposals(space!, 10)
        : await fetchRecentProposals(space!, 10);

    let votes: SnapshotVote[] = [];
    if (mode === "whales" && proposals[0]) {
      votes = await fetchProposalVotes(proposals[0].id, 15);
    }

    const spaceName = proposals[0]?.space?.name ?? space;

    return {
      mode,
      space,
      spaceName,
      proposals,
      votes,
      voter,
      dataSources,
      summary:
        mode === "whales" && votes.length > 0
          ? `Top ${votes.length} voters on "${proposals[0]?.title ?? "latest proposal"}" in ${spaceName}`
          : `${proposals.length} proposal(s) for ${spaceName ?? space}`,
    };
  } catch {
    dataSources.snapshot = "unavailable";
    return {
      mode,
      space,
      proposals: [],
      votes: [],
      dataSources,
      summary: "Snapshot API unavailable — check network or try a known DAO (e.g. UNI, Aave, ENS)",
    };
  }
}

export function formatGovernance(result: GovernanceResult): string {
  const lines = [result.summary];

  if (result.proposals.length > 0) {
    lines.push("\nProposals:");
    for (const p of result.proposals.slice(0, 5)) {
      const end = new Date(p.end * 1000).toISOString().slice(0, 10);
      lines.push(`• [${p.state}] ${p.title} (ends ${end}, scores: ${p.scores_total})`);
    }
  }

  if (result.votes.length > 0) {
    lines.push("\nTop voters:");
    for (const v of result.votes.slice(0, 5)) {
      lines.push(`• ${v.voter.slice(0, 12)}… — ${v.vp.toFixed(2)} VP`);
    }
  }

  return lines.join("\n");
}
