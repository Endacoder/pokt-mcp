export type LlmProvider = "openai" | "litellm";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  /** OpenAI-compatible base URL including `/v1`. */
  baseUrl: string;
  model: string;
  enabled: boolean;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function isEnabled(env: NodeJS.ProcessEnv): boolean {
  const flag = env.FEATURE_NL_LLM;
  return flag === "true" || flag === "1";
}

export interface LlmConfigValidation {
  featureEnabled: boolean;
  config: LlmConfig | null;
  warnings: string[];
}

export function validateLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfigValidation {
  const featureEnabled = isEnabled(env);
  const warnings: string[] = [];

  if (!featureEnabled) {
    warnings.push(
      "FEATURE_NL_LLM is off — natural language beyond templates/heuristics will fail unless FEATURE_AGENT_LOOP is enabled.",
    );
    return { featureEnabled, config: null, warnings };
  }

  const provider = (env.LLM_PROVIDER ?? "openai").toLowerCase() as LlmProvider;
  const model = env.LLM_MODEL ?? env.LITELLM_MODEL ?? (provider === "litellm" ? undefined : "gpt-4o-mini");

  if (provider === "litellm" && !model) {
    warnings.push(
      "FEATURE_NL_LLM is on but LLM_MODEL is not set — required for LiteLLM. List models: curl $LITELLM_BASE_URL/v1/models",
    );
    return { featureEnabled, config: null, warnings };
  }

  if (provider === "openai" && !env.OPENAI_API_KEY) {
    warnings.push("FEATURE_NL_LLM is on but OPENAI_API_KEY is not set.");
    return { featureEnabled, config: null, warnings };
  }

  const config = loadLlmConfig(env);
  if (!config) {
    warnings.push("LLM configuration incomplete — check LLM_PROVIDER, LLM_MODEL, and API keys.");
  }

  return { featureEnabled, config, warnings };
}

export function logLlmConfigStatus(serviceName: string, env: NodeJS.ProcessEnv = process.env): void {
  const agentEnabled = isAgentLoopEnabled(env);
  const validation = validateLlmConfig(env);

  if (validation.config) {
    console.error(
      `[${serviceName}] LLM enabled: provider=${validation.config.provider} model=${validation.config.model}`,
    );
  } else if (validation.featureEnabled) {
    for (const warning of validation.warnings) {
      console.error(`[${serviceName}] LLM warning: ${warning}`);
    }
  } else {
    console.error(`[${serviceName}] LLM disabled (template/heuristic NL only)`);
  }

  console.error(
    `[${serviceName}] Agent loop: ${agentEnabled ? "enabled" : "disabled"} (max steps: ${loadAgentMaxSteps(env)})`,
  );
}

export function isAgentLoopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.FEATURE_AGENT_LOOP;
  if (flag === "false" || flag === "0") return false;
  return flag === "true" || flag === "1";
}

export function loadAgentMaxSteps(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AGENT_MAX_STEPS;
  const n = raw ? parseInt(raw, 10) : 8;
  return Number.isFinite(n) && n > 0 ? n : 8;
}

/** Upper bound for OpenAI-compatible LLM HTTP calls (avoid Cloudflare 524 on hung proxies). */
export function loadLlmRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_REQUEST_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : 90_000;
  return Number.isFinite(n) && n >= 5_000 ? n : 90_000;
}

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  if (!isEnabled(env)) {
    return null;
  }

  const provider = (env.LLM_PROVIDER ?? "openai").toLowerCase() as LlmProvider;
  const model =
    env.LLM_MODEL ??
    env.LITELLM_MODEL ??
    (provider === "litellm" ? undefined : "gpt-4o-mini");

  if (provider === "litellm") {
    const baseUrl = normalizeBaseUrl(env.LITELLM_BASE_URL ?? "http://localhost:4000");
    const apiKey = env.LITELLM_API_KEY ?? env.OPENAI_API_KEY ?? "sk-litellm";
    if (!model) {
      return null;
    }
    return {
      provider: "litellm",
      apiKey,
      baseUrl,
      model,
      enabled: true,
    };
  }

  const openAiModel = model ?? "gpt-4o-mini";

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  return {
    provider: "openai",
    apiKey,
    baseUrl: normalizeBaseUrl(env.OPENAI_BASE_URL ?? "https://api.openai.com"),
    model: openAiModel,
    enabled: true,
  };
}
