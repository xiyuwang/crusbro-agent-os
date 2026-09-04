import { AnthropicProvider, OpenAIProvider } from "../engine/infra/provider.js";
import { applyProviderRegistry } from "./llm-providers.js";
import { isOrchestratorManager } from "./orchestration-helpers.js";

export function resolveAgentLoopProviderFromLlmConfig(llmCfg: Record<string, unknown>) {
  const cfg: Record<string, unknown> = applyProviderRegistry({ ...(llmCfg || {}) });
  const provider = String(cfg.provider || "openai_compatible").trim().toLowerCase();
  const apiKey = String(cfg.api_key || "").trim();
  const modelName = String(cfg.model || "").trim();
  const baseUrl = String(cfg.base_url || "").trim();
  let openaiApi = String(cfg.api || "chat").trim() || "chat";
  const bu = baseUrl.toLowerCase();
  const presetThirdParty =
    provider === "qwen" ||
    provider === "minimax" ||
    provider === "glm" ||
    provider === "kimi" ||
    provider === "deepseek";
  const likelyThirdPartyOpenAICompat =
    presetThirdParty || (Boolean(bu) && !bu.includes("api.openai.com") && !bu.includes("openai.azure.com"));
  if (openaiApi === "responses" && likelyThirdPartyOpenAICompat) {
    openaiApi = "chat";
  }

  if (!apiKey || !modelName) return null;

  const looksAnthropic = baseUrl.includes("/anthropic") || provider === "anthropic";
  if (looksAnthropic) {
    return new AnthropicProvider(apiKey, modelName, baseUrl);
  }

  if (
    provider === "openai_compatible" ||
    provider === "openai" ||
    provider === "qwen" ||
    provider === "minimax" ||
    provider === "glm" ||
    provider === "kimi" ||
    provider === "deepseek"
  ) {
    const rawEb = cfg.extra_body ?? cfg.extraBody;
    const extraBody: Record<string, unknown> | undefined =
      rawEb && typeof rawEb === "object" && !Array.isArray(rawEb) ? { ...(rawEb as Record<string, unknown>) } : undefined;
    return new OpenAIProvider(apiKey, modelName, baseUrl || "https://api.openai.com/v1", undefined, {
      providerOptions: { openaiApi: openaiApi as "chat" | "responses" },
      ...(extraBody ? { extraBody } : {}),
    });
  }
  throw new Error(`unsupported_llm_provider:${provider}`);
}

/** Re-apply manager tool_choice after LLM pool fallback. */
export function normalizeManagerToolChoiceForLlmCfg(
  llmCfg: Record<string, unknown>,
  templateId: string,
  input: unknown
): void {
  if (!isOrchestratorManager(templateId, input)) return;
  delete llmCfg.tool_choice;
  delete llmCfg.toolChoice;
  const provider = String(llmCfg.provider || "").toLowerCase();
  const baseUrl = String(llmCfg.base_url || "").toLowerCase();
  const looksAnthropic = baseUrl.includes("/anthropic") || provider === "anthropic";
  const deepseekOpenAiCompat =
    provider === "deepseek" || (baseUrl.includes("api.deepseek.com") && !baseUrl.includes("/anthropic"));
  const prevEb = llmCfg.extra_body ?? llmCfg.extraBody;
  const eb: Record<string, unknown> =
    prevEb && typeof prevEb === "object" && !Array.isArray(prevEb) ? { ...(prevEb as Record<string, unknown>) } : {};
  if (eb.tool_choice != null && typeof eb.tool_choice === "object") delete eb.tool_choice;
  const managerToolChoiceUnsafeForRequired =
    baseUrl.includes("dashscope.aliyuncs.com") ||
    baseUrl.includes("dashscope-intl.aliyuncs.com") ||
    deepseekOpenAiCompat;
  eb.tool_choice = looksAnthropic ? { type: "any" } : managerToolChoiceUnsafeForRequired ? "auto" : "required";
  if (baseUrl.includes("dashscope.aliyuncs.com") || baseUrl.includes("dashscope-intl.aliyuncs.com")) {
    delete eb.thinking;
  }
  if (deepseekOpenAiCompat) {
    const th = eb.thinking;
    const hasThinking =
      th != null &&
      (typeof th === "object" && !Array.isArray(th)
        ? String((th as Record<string, unknown>).type || "").trim() !== ""
        : String(th).trim() !== "");
    if (!hasThinking) eb.thinking = { type: "disabled" };
  }
  llmCfg.extra_body = eb;
}

export function applyManagerToolChoiceToLlmCfg(llmCfgMerged: Record<string, unknown>, templateId: string, input: unknown): void {
  if (!isOrchestratorManager(templateId, input)) return;
  delete llmCfgMerged.tool_choice;
  delete llmCfgMerged.toolChoice;
  const prevEb = llmCfgMerged.extra_body ?? llmCfgMerged.extraBody;
  const eb: Record<string, unknown> =
    prevEb && typeof prevEb === "object" && !Array.isArray(prevEb)
      ? { ...(prevEb as Record<string, unknown>) }
      : {};
  const provider = String(llmCfgMerged.provider || "").toLowerCase();
  const baseUrl = String(llmCfgMerged.base_url || "").toLowerCase();
  const looksAnthropic = baseUrl.includes("/anthropic") || provider === "anthropic";
  const deepseekOpenAiCompat =
    provider === "deepseek" || (baseUrl.includes("api.deepseek.com") && !baseUrl.includes("/anthropic"));
  const managerToolChoiceUnsafeForRequired =
    baseUrl.includes("dashscope.aliyuncs.com") ||
    baseUrl.includes("dashscope-intl.aliyuncs.com") ||
    deepseekOpenAiCompat;
  eb.tool_choice = looksAnthropic ? { type: "any" } : managerToolChoiceUnsafeForRequired ? "auto" : "required";
  if (deepseekOpenAiCompat) {
    const th = eb.thinking;
    const hasThinking =
      th != null &&
      (typeof th === "object" && !Array.isArray(th)
        ? String((th as Record<string, unknown>).type || "").trim() !== ""
        : String(th).trim() !== "");
    if (!hasThinking) eb.thinking = { type: "disabled" };
  }
  llmCfgMerged.extra_body = eb;
}

export function applyDeepseekToolChoiceDefault(llmCfgMerged: Record<string, unknown>): void {
  const provider = String(llmCfgMerged.provider || "").toLowerCase();
  const baseUrl = String(llmCfgMerged.base_url || "").toLowerCase();
  const deepseekOpenAiCompat =
    provider === "deepseek" || (baseUrl.includes("api.deepseek.com") && !baseUrl.includes("/anthropic"));
  if (!deepseekOpenAiCompat) return;
  const prevEb = llmCfgMerged.extra_body ?? llmCfgMerged.extraBody;
  const eb: Record<string, unknown> =
    prevEb && typeof prevEb === "object" && !Array.isArray(prevEb)
      ? { ...(prevEb as Record<string, unknown>) }
      : {};
  if ((eb as Record<string, unknown>).tool_choice == null) {
    (eb as Record<string, unknown>).tool_choice = "auto";
  }
  llmCfgMerged.extra_body = eb;
}
