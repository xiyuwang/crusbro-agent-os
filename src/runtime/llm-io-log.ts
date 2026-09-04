import { getExecutionContext } from "./execution-context.js";
import { redactLlmConfigForLog } from "./llm-providers.js";

function envBool(name: string, defaultVal: boolean): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return defaultVal;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return defaultVal;
}

function envInt(name: string, def: number): number {
  const v = Number.parseInt(String(process.env[name] ?? "").trim(), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated ${s.length - max} chars]`;
}

export function isLlmIoLogEnabled(): boolean {
  return envBool("LLM_LOG", true);
}

function baseFields(tool: string) {
  const ctx = getExecutionContext();
  return {
    tool,
    ts: new Date().toISOString(),
    run_id: ctx?.run_id || null,
    notify_id: ctx?.notify_id || null,
    execution_id: ctx?.execution_id || null,
    opc_id: ctx?.opc_id || null,
    tenant_id: ctx?.tenant_id || null,
  };
}

export function logLlmRequest(payload: {
  tool: string;
  purpose?: string;
  cfg: Record<string, unknown>;
  prompt: string;
  temperature?: number;
  attempt?: number;
  json_schema?: unknown;
}): void {
  if (!isLlmIoLogEnabled()) return;
  const maxPrompt = envInt("LLM_LOG_MAX_PROMPT_CHARS", 8000);
  const maxSchema = envInt("LLM_LOG_MAX_SCHEMA_CHARS", 6000);
  const verbose = envBool("LLM_LOG_VERBOSE", false);
  let schemaStr: string | undefined;
  if (payload.json_schema !== undefined) {
    const raw = JSON.stringify(payload.json_schema);
    schemaStr = verbose ? raw : trunc(raw, maxSchema);
  }

  console.log(
    "[llm:request]",
    JSON.stringify({
      ...baseFields(payload.tool),
      phase: "request",
      purpose: payload.purpose || null,
      attempt: payload.attempt ?? null,
      temperature: payload.temperature ?? null,
      llm: redactLlmConfigForLog({ ...(payload.cfg || {}) }),
      prompt: verbose ? payload.prompt : trunc(payload.prompt || "", maxPrompt),
      json_schema: schemaStr,
    })
  );
}

export function logLlmResponse(payload: {
  tool: string;
  provider_id: string;
  model: string;
  ok: boolean;
  text?: string;
  usage?: unknown;
  attempt?: number;
}): void {
  if (!isLlmIoLogEnabled()) return;
  const maxOut = envInt("LLM_LOG_MAX_RESPONSE_CHARS", 16000);
  const verbose = envBool("LLM_LOG_VERBOSE", false);
  const text = payload.text == null ? "" : String(payload.text);
  console.log(
    "[llm:response]",
    JSON.stringify({
      ...baseFields(payload.tool),
      phase: "response",
      ok: payload.ok,
      attempt: payload.attempt ?? null,
      provider_id: payload.provider_id,
      model: payload.model,
      usage: payload.usage ?? null,
      text: verbose ? text : trunc(text, maxOut),
    })
  );
}

export function logLlmError(payload: { tool: string; message: string; attempt?: number }): void {
  if (!isLlmIoLogEnabled()) return;
  console.log(
    "[llm:error]",
    JSON.stringify({
      ...baseFields(payload.tool),
      phase: "error",
      attempt: payload.attempt ?? null,
      message: trunc(payload.message || "", 4000),
    })
  );
}
