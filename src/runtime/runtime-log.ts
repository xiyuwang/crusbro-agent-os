import { appendFile } from "node:fs/promises";
import { getExecutionContext } from "./execution-context.js";

type Level = "debug" | "info" | "warn" | "error";

function envStr(name: string, def = ""): string {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

function envBool(name: string, def: boolean): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return def;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return def;
}

function levelRank(l: Level): number {
  return l === "debug" ? 10 : l === "info" ? 20 : l === "warn" ? 30 : 40;
}

function shouldLog(l: Level): boolean {
  if (!envBool("RUNTIME_LOG", true)) return false;
  const want = (envStr("RUNTIME_LOG_LEVEL", envStr("LOG_LEVEL", "INFO")) || "INFO").toLowerCase() as Level;
  const normalized: Level =
    want === "debug" || want === "info" || want === "warn" || want === "error" ? want : "info";
  return levelRank(l) >= levelRank(normalized);
}

function baseFields() {
  const ctx = getExecutionContext();
  return {
    ts: new Date().toISOString(),
    run_id: ctx?.run_id || null,
    notify_id: ctx?.notify_id || null,
    execution_id: ctx?.execution_id || null,
    opc_id: ctx?.opc_id || null,
    tenant_id: ctx?.tenant_id || null,
  };
}

let writeChain: Promise<void> = Promise.resolve();
async function writeFileLine(line: string): Promise<void> {
  const file = envStr("RUNTIME_LOG_FILE", "");
  if (!file) return;
  writeChain = writeChain
    .then(() => appendFile(file, line + "\n", { encoding: "utf-8" }))
    .catch(() => appendFile(file, line + "\n", { encoding: "utf-8" }));
  await writeChain;
}

export function runtimeLog(level: Level, event: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const payload = { level, event, ...baseFields(), ...(fields || {}) };
  const line = JSON.stringify(payload);
  if (level === "error") console.error("[runtime]", line);
  else if (level === "warn") console.warn("[runtime]", line);
  else console.log("[runtime]", line);
  void writeFileLine(line);
}

export const logDebug = (event: string, fields?: Record<string, unknown>) => runtimeLog("debug", event, fields);
export const logInfo = (event: string, fields?: Record<string, unknown>) => runtimeLog("info", event, fields);
export const logWarn = (event: string, fields?: Record<string, unknown>) => runtimeLog("warn", event, fields);
export const logError = (event: string, fields?: Record<string, unknown>) => runtimeLog("error", event, fields);
