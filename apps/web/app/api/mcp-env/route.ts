import { validateLlmConfig, isAgentLoopEnabled, loadAgentMaxSteps } from "@pokt-mcp/shared";
import {
  buildIntentMcpServerEntry,
  buildIntentMcpStdioEnv,
  defaultIntentMcpRemoteUrl,
  isIntentMcpConfigured,
  isIntentMcpEnabled,
} from "../../../lib/intent-mcp-config";
import { buildMcpStdioEnv } from "../../../lib/mcp-config";

export const runtime = "nodejs";

export async function GET() {
  const validation = validateLlmConfig();
  const stdioEnv = buildMcpStdioEnv(process.env);
  const intentEnabled = isIntentMcpEnabled(process.env);
  const hasLocalArgs = Boolean(process.env.INTENT_MCP_ARGS?.trim());
  const hasSseUrl = Boolean(process.env.NEXT_PUBLIC_INTENT_MCP_SSE_URL?.trim());
  const mode = hasSseUrl ? "sse" : hasLocalArgs ? "stdio-local" : "mcp-remote";

  return Response.json({
    llmConfigured: validation.config !== null,
    featureNlLlm: validation.featureEnabled,
    agentLoopEnabled: isAgentLoopEnabled(process.env),
    agentMaxSteps: loadAgentMaxSteps(process.env),
    warnings: validation.warnings,
    stdioEnv,
    intentMcp: {
      enabled: intentEnabled,
      configured: isIntentMcpConfigured(process.env),
      mode,
      stdioEnv: intentEnabled ? buildIntentMcpStdioEnv(process.env) : undefined,
      hasApiKey: Boolean(process.env.INTENT_MCP_API_KEY?.trim()),
      hasCommand: hasLocalArgs,
      hasSseUrl,
      remoteUrl: defaultIntentMcpRemoteUrl(process.env),
      serverEntry: intentEnabled ? buildIntentMcpServerEntry(process.env) : undefined,
    },
  });
}
