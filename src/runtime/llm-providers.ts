/**
 * OpenAI-compatible endpoint presets (Plan P9). User still supplies api_key/model;
 * base_url is filled from provider id when omitted.
 */
export const OPENAI_COMPATIBLE_PRESETS: Record<string, { base_url: string }> = {
  openai: { base_url: "https://api.openai.com/v1" },
  qwen: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  minimax: { base_url: "https://api.minimax.chat/v1" },
  glm: { base_url: "https://open.bigmodel.cn/api/paas/v4" },
  kimi: { base_url: "https://api.moonshot.cn/v1" },
  /** OpenAI-compatible; official base_url per https://api-docs.deepseek.com/zh-cn/ */
  deepseek: { base_url: "https://api.deepseek.com" },
};

/** Explicit registry ids (keep in sync with platform `user_config_schema.KNOWN_LLM_PROVIDERS`). */
export const REGISTERED_PROVIDER_IDS = Object.freeze(Object.keys(OPENAI_COMPATIBLE_PRESETS));

/** Display / preset aliases → canonical model id for the vendor API. */
export const MODEL_ALIASES: Record<string, string> = {
  "fast-default": "gpt-4o-mini",
};

/** Redact secrets for logs (BAR / ops). */
export function redactLlmConfigForLog(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  if (typeof out.api_key === "string" && out.api_key.length > 8) {
    out.api_key = `${String(out.api_key).slice(0, 4)}…redacted`;
  }
  return out;
}

export function applyProviderRegistry(cfg: Record<string, unknown>): Record<string, unknown> {
  const out = { ...cfg };
  const p = String(out.provider || "")
    .trim()
    .toLowerCase();
  if (p && OPENAI_COMPATIBLE_PRESETS[p] && !String(out.base_url || "").trim()) {
    out.base_url = OPENAI_COMPATIBLE_PRESETS[p].base_url;
  }
  const m = String(out.model || "").trim();
  if (m && MODEL_ALIASES[m]) {
    out.model = MODEL_ALIASES[m];
  }
  return out;
}
