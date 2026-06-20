/** POKT MCP — AI Agent branding pack (source of truth for copy + tokens). */

export const BRAND = {
  name: "POKT MCP",
  shortName: "POKT",
  suffix: "MCP",
  tagline: "AI Agents × Pocket Network × MCP",
  description: "Agent-native chat for Pocket Network RPC — tools, chains, and wallet actions via MCP.",
  agentLabel: "Agent",
  agentOnline: "Agent online",
  protocolActive: "MCP protocol active",
} as const;

/** Core palette — mirrors CSS variables in globals.css */
export const BRAND_COLORS = {
  agentBlue: "#0077EE",
  signalCyan: "#00DDBB",
  agentViolet: "#7C5CFC",
  protocolDark: "#111122",
  shellGray: "#F1F1F5",
  chatSurface: "#FAFAFC",
} as const;

export const AGENT_STATES = {
  idle: { label: "Ready", color: "muted" },
  thinking: { label: "Thinking", color: "violet" },
  acting: { label: "Running tools", color: "accent" },
  streaming: { label: "Responding", color: "cyan" },
  done: { label: "Complete", color: "success" },
  error: { label: "Error", color: "error" },
} as const;

export type AgentStateKey = keyof typeof AGENT_STATES;
