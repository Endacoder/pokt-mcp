import type { LlmConfig, LlmStreamCallbacks, RpcIntent } from "@pokt-mcp/shared";
import { loadLlmRequestTimeoutMs, streamOpenAiChatCompletion } from "@pokt-mcp/shared";
import {
  assessGasPrice,
  formatGasAssessmentMessage,
  gweiFromHex,
  wantsGasAssessment,
  type GasAssessment,
} from "./gas-assessment.js";
import {
  formatTxNotFoundMessage,
  isTxLookupMethod,
  wantsTxExplain,
  type TxNotFoundInfo,
} from "./tx-lookup.js";

export function needsResultInterpretation(query: string, intent: RpcIntent): boolean {
  if (intent.method === "eth_gasPrice" && wantsGasAssessment(query)) return true;
  if (intent.method === "__query_at_time__" && wantsGasAssessment(query)) return true;
  if (isTxLookupMethod(intent.method) && wantsTxExplain(query)) return true;
  return false;
}

export function buildInterpretationFacts(
  intent: RpcIntent,
  output: unknown,
): Record<string, unknown> | null {
  const o = output as { result?: unknown; gasGwei?: number; subject?: string; chain?: string };

  if (intent.method === "eth_gasPrice" && typeof o.result === "string") {
    const gwei = gweiFromHex(o.result);
    const assessment = assessGasPrice(gwei, intent.chain);
    return {
      type: "gas_price",
      chain: intent.chain,
      gwei,
      assessment,
      dataSource: "pocket_network_rpc (eth_gasPrice)",
    };
  }

  if (intent.method === "__query_at_time__" && o.subject === "gas" && o.gasGwei !== undefined) {
    const chain = o.chain ?? intent.chain;
    const assessment = assessGasPrice(o.gasGwei, chain);
    return {
      type: "historical_gas_price",
      chain,
      gwei: o.gasGwei,
      assessment,
      offsetLabel: (o as { offsetLabel?: string }).offsetLabel,
      dataSource: "pocket_network_rpc (historical block baseFee/gasPrice)",
    };
  }

  if (isTxLookupMethod(intent.method) && o.result == null) {
    const notFound = (o as { notFound?: TxNotFoundInfo }).notFound;
    if (notFound) {
      return {
        type: "tx_not_found",
        chain: notFound.chain,
        chainName: notFound.chainName,
        hash: notFound.hash,
        method: intent.method,
        explorerUrl: notFound.explorerUrl,
        dataSource: "pocket_network_rpc",
      };
    }
  }

  return null;
}

export function formatInterpretationFallback(
  query: string,
  intent: RpcIntent,
  output: unknown,
): string | null {
  if (!needsResultInterpretation(query, intent)) return null;

  const facts = buildInterpretationFacts(intent, output);
  if (!facts) return null;

  if (facts.type === "tx_not_found") {
    const notFound = (output as { notFound?: TxNotFoundInfo }).notFound;
    if (notFound) return formatTxNotFoundMessage(notFound);
  }

  const assessment = facts.assessment as GasAssessment;
  const chain = (facts.chain as string) ?? intent.chain;
  return formatGasAssessmentMessage(chain, assessment);
}

const INTERPRET_SYSTEM = `You answer blockchain questions using ONLY the structured facts provided.
Be concise (2–4 sentences). Directly address what the user asked (e.g. low vs high).
Do not invent numbers or sources. Mention the current gwei value and how it compares to typical ranges.`;

export async function interpretQueryResult(
  query: string,
  intent: RpcIntent,
  output: unknown,
  config: LlmConfig,
  stream?: LlmStreamCallbacks,
): Promise<string | null> {
  const facts = buildInterpretationFacts(intent, output);
  if (!facts) return null;

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: INTERPRET_SYSTEM },
      {
        role: "user",
        content: `User question: ${query}\n\nStructured facts (from on-chain RPC):\n${JSON.stringify(facts, null, 2)}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 256,
  };

  try {
    if (stream?.onReasoning) {
      const completion = streamOpenAiChatCompletion(config, body);
      let content = "";
      while (true) {
        const step = await completion.next();
        if (step.done) {
          content = step.value.content ?? content;
          break;
        }
        if (step.value.type === "reasoning") {
          stream.onReasoning(step.value.text);
        } else {
          content += step.value.text;
        }
      }
      return content.trim() || formatInterpretationFallback(query, intent, output);
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(loadLlmRequestTimeoutMs()),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return formatInterpretationFallback(query, intent, output);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    return content || formatInterpretationFallback(query, intent, output);
  } catch {
    return formatInterpretationFallback(query, intent, output);
  }
}