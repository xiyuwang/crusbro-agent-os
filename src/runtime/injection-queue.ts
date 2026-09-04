import crypto from "crypto";

const MAX_RESULT_LENGTH = 4000;

export type InjectionType = "task_result" | "task_failed" | "task_cancelled";

export function buildInjectionMessage(opts: {
  notifyId: string;
  agentKey: string;
  status: "completed" | "failed" | "cancelled";
  description?: string;
  resultText?: string;
  error?: string;
}): string {
  const base =
    `[子任务回注] notify_id=${opts.notifyId}, agent=${opts.agentKey}\n` + `描述: ${opts.description || ""}\n`;
  if (opts.status === "completed") {
    let result = String(opts.resultText || "(无输出)");
    if (result.length > MAX_RESULT_LENGTH) {
      result = result.slice(0, MAX_RESULT_LENGTH) + "\n\n[内容已截断，完整结果可通过 run trace / notify executions 查看]";
    }
    return base + `交付物:\n${result}`;
  }
  if (opts.status === "cancelled") {
    return base + `状态: cancelled`;
  }
  return base + `错误: ${opts.error || "未知错误"}`;
}

export function injectionIdempotencyKey(runId: string, sourceNotifyId: string, intent = "injection.result"): string {
  const raw = `${runId}:${intent}:${sourceNotifyId}`;
  const h = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `inj:${runId}:${intent}:${h}`;
}
