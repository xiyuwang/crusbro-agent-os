/**
 * memory-agent：按 config_snapshot.llm_memory_scope 生成稳定 Agent.agentId，便于 JSONStore 跨 notify 复用消息历史。
 */
import crypto from "crypto";
import { isManagerOrchestrationKickoff, isOrchestratorManager } from "./orchestration-helpers.js";

export { isManagerOrchestrationKickoff };

export function stableAgentIdKey(parts: string[]): string {
  const h = crypto.createHash("sha256").update(parts.filter(Boolean).join("|"), "utf8").digest("hex");
  return `opc_${h.slice(0, 48)}`;
}

export function resolveRuntimeAgentId(
  templateId: string,
  input: Record<string, unknown> | null | undefined
): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const cfg = (input as any).config_snapshot;
  const cfgObj = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
  const scope = String(cfgObj.llm_memory_scope || "run").trim();
  if (scope === "none") return undefined;

  const tenant = String((input as any).tenant_id || "").trim();
  const opc = String((input as any).opc_id || "").trim();
  const runId = String((input as any).run_id || "").trim();
  const tpl = String(templateId || "").trim() || "default";

  if (!tenant) return undefined;

  if (scope === "opc_agent") {
    if (!opc) return undefined;
    return stableAgentIdKey([tenant, opc, tpl]);
  }
  if (!runId) return undefined;
  return stableAgentIdKey([tenant, opc || "-", tpl, runId]);
}

export function buildNotifyUserContent(
  notifyId: string,
  input: Record<string, unknown> | null | undefined,
  templateId?: string
): string {
  const entry = String((input as any)?.entry || "notify").trim() || "notify";
  const tid = (input as any)?.trigger_id != null ? String((input as any).trigger_id) : "";
  const ni = String((input as any)?.notify_intent || (input as any)?.intent || "").trim();
  const patrol = (input as any)?.patrol_directive;
  const patrolBlock =
    typeof patrol === "string" && patrol.trim() ? `\n[patrol_directive]\n${patrol.trim()}\n` : "";
  const tpl = String(templateId || "").trim();
  const kickoffBlock =
    isOrchestratorManager(tpl, input) && isManagerOrchestrationKickoff(input)
      ? `\n[orchestration_kickoff]\n` +
        `notify_intent=${ni || "(none)"}\n` +
        "硬约束：你必须通过工具完成编排，禁止零工具结束。至少调用一次 agent.notify（派 Worker）或 artifact.write / run.set_status 等。\n"
      : "";
  const lines = [
    `[entry=${entry}${tid ? ` trigger_id=${tid}` : ""}${ni ? ` notify_intent=${ni}` : ""}]`,
    kickoffBlock.trim() ? kickoffBlock : "",
    patrolBlock,
    `notify_id=${notifyId}`,
    `input_json=${JSON.stringify(input || {})}`,
  ];
  return lines.filter(Boolean).join("\n");
}
