import { loadSnapshotApiKey } from "./config.js";

/** Public Snapshot Hub — no API key required (optional SNAPSHOT_API_KEY for higher rate limits). */
const SNAPSHOT_HUB = "https://hub.snapshot.org/graphql";

export type SnapshotProposal = {
  id: string;
  title: string;
  body: string;
  state: string;
  start: number;
  end: number;
  scores: number[];
  scores_total: number;
  quorum: number;
  choices: string[];
  space: { id: string; name: string };
};

export type SnapshotVote = {
  id: string;
  voter: string;
  choice: number | number[];
  vp: number;
  created: number;
  proposal: { id: string; title: string };
};

async function snapshotQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const apiKey = loadSnapshotApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const res = await fetch(SNAPSHOT_HUB, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Snapshot API failed (${res.status})`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "Snapshot query failed");
  }
  if (!json.data) {
    throw new Error("Snapshot returned no data");
  }
  return json.data;
}

const KNOWN_SPACES: Record<string, string> = {
  uni: "uniswapgovernance.eth",
  uniswap: "uniswapgovernance.eth",
  aave: "aavedao.eth",
  compound: "comp-vote.eth",
  ens: "ens.eth",
  lido: "lido-snap.eth",
  op: "opcollective.eth",
  optimism: "opcollective.eth",
  arb: "arbitrumfoundation.eth",
  arbitrum: "arbitrumfoundation.eth",
  gitcoin: "gitcoindao.eth",
  maker: "makerdao.eth",
  curve: "curve.eth",
};

export function resolveSnapshotSpace(query: string): string | null {
  const q = query.toLowerCase();
  for (const [key, space] of Object.entries(KNOWN_SPACES)) {
    if (new RegExp(`\\b${key}\\b`).test(q)) return space;
  }
  const match = q.match(/\bspace[:\s]+([a-z0-9.-]+)/);
  return match?.[1] ?? null;
}

export async function fetchActiveProposals(space: string, limit = 10): Promise<SnapshotProposal[]> {
  const query = `query Proposals($space: String!, $state: String!, $limit: Int!) {
      proposals(
        first: $limit
        where: { space: $space, state: $state }
        orderBy: "created"
        orderDirection: desc
      ) {
        id title body state start end scores scores_total quorum choices
        space { id name }
      }
    }`;

  const [active, pending] = await Promise.all([
    snapshotQuery<{ proposals: SnapshotProposal[] }>(query, { space, state: "active", limit }),
    snapshotQuery<{ proposals: SnapshotProposal[] }>(query, { space, state: "pending", limit }),
  ]);

  const merged = [...(active.proposals ?? []), ...(pending.proposals ?? [])];
  merged.sort((a, b) => b.start - a.start);
  return merged.slice(0, limit);
}

export async function fetchRecentProposals(space: string, limit = 10): Promise<SnapshotProposal[]> {
  const data = await snapshotQuery<{ proposals: SnapshotProposal[] }>(
    `query Proposals($space: String!, $limit: Int!) {
      proposals(
        first: $limit
        where: { space: $space }
        orderBy: "created"
        orderDirection: desc
      ) {
        id title body state start end scores scores_total quorum choices
        space { id name }
      }
    }`,
    { space, limit },
  );
  return data.proposals ?? [];
}

export async function fetchProposalVotes(proposalId: string, limit = 20): Promise<SnapshotVote[]> {
  const data = await snapshotQuery<{ votes: SnapshotVote[] }>(
    `query Votes($proposal: String!, $limit: Int!) {
      votes(
        first: $limit
        where: { proposal: $proposal }
        orderBy: "vp"
        orderDirection: desc
      ) {
        id voter choice vp created
        proposal { id title }
      }
    }`,
    { proposal: proposalId, limit },
  );
  return data.votes ?? [];
}

export async function fetchVoterHistory(voter: string, limit = 10): Promise<SnapshotVote[]> {
  const data = await snapshotQuery<{ votes: SnapshotVote[] }>(
    `query Votes($voter: String!, $limit: Int!) {
      votes(
        first: $limit
        where: { voter: $voter }
        orderBy: "created"
        orderDirection: desc
      ) {
        id voter choice vp created
        proposal { id title }
      }
    }`,
    { voter: voter.toLowerCase(), limit },
  );
  return data.votes ?? [];
}

export async function searchSpaces(query: string, limit = 5): Promise<Array<{ id: string; name: string }>> {
  const data = await snapshotQuery<{ spaces: Array<{ id: string; name: string }> }>(
    `query Spaces($query: String!, $limit: Int!) {
      spaces(first: $limit, where: { search: $query }) { id name }
    }`,
    { query, limit },
  );
  return data.spaces ?? [];
}
