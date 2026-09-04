/**
 * Optional LLM HTTP 调试日志（零依赖；由环境变量开关）。
 * 与 runtime 的 RUNTIME_DEBUG_LLM_HTTP 对齐，并兼容 DEBUG_LLM_HTTP。
 */

function llmHttpDebugEnabled(): boolean {
  const v = String(process.env.RUNTIME_DEBUG_LLM_HTTP || process.env.DEBUG_LLM_HTTP || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 仅在调试开启时输出；避免在生产默认打印密钥与大体。 */
export function logLlmHttp(tag: string, data?: unknown, maxLen?: number): void {
  if (!llmHttpDebugEnabled()) return;
  try {
    if (data === undefined) {
      console.debug(`[llm-http] ${tag}`);
      return;
    }
    let s = typeof data === "string" ? data : JSON.stringify(data);
    const cap = typeof maxLen === "number" && maxLen > 0 ? maxLen : 120_000;
    if (s.length > cap) s = `${s.slice(0, cap)}…`;
    console.debug(`[llm-http] ${tag}`, s);
  } catch {
    console.debug(`[llm-http] ${tag} <unserializable>`);
  }
}

const SENSITIVE_HEADER = new Set(
  ["x-api-key", "authorization", "api-key", "openai-api-key", "x-goog-api-key"].map((h) => h.toLowerCase())
);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  for (const k of Object.keys(out)) {
    if (SENSITIVE_HEADER.has(k.toLowerCase())) out[k] = "[REDACTED]";
  }
  return out;
}

export function appendStreamSseCapture(capture: { s: string }, line: string): void {
  capture.s += `${line}\n`;
}
