/** Tool stream normalization + audit helpers for notify sessions. */

export const MAX_TOOL_EVENTS = 200;
export const MAX_EVENT_PREVIEW_CHARS = 1200;

export function previewToolPayload(v: unknown, maxLen = MAX_EVENT_PREVIEW_CHARS): string | null {
  try {
    if (v == null) return null;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > maxLen ? s.slice(0, maxLen) + "…(truncated)" : s;
  } catch {
    return String(v);
  }
}

export function normalizeToolName(ev: unknown): string {
  const e = ev as Record<string, unknown>;
  const call = e?.call as Record<string, unknown> | undefined;
  return String(e?.name || e?.tool_name || e?.toolName || call?.name || "").trim();
}

export function normalizeCallId(ev: unknown): string {
  const e = ev as Record<string, unknown>;
  const call = e?.call as Record<string, unknown> | undefined;
  return String(e?.call_id || e?.callId || e?.id || call?.id || "").trim();
}

export function argsPreview(v: unknown, maxLen = 600): string {
  try {
    const s =
      typeof v === "string"
        ? v
        : JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? String(val) : val), 0);
    return String(s || "").slice(0, maxLen);
  } catch {
    return String(v ?? "").slice(0, maxLen);
  }
}

export function normalizeToolEvent(e: unknown): Record<string, unknown> {
  const ev = e as Record<string, unknown>;
  const t = String(ev?.type || "").trim() || "tool:event";
  const name = normalizeToolName(ev) || null;
  const call_id = normalizeCallId(ev) || null;
  const call = ev?.call as Record<string, unknown> | undefined;
  const callInput = call?.input ?? call?.inputPreview ?? ev?.input ?? ev?.args ?? ev?.arguments;
  if (t === "tool:start") {
    return { type: t, name, call_id, input_preview: previewToolPayload(callInput) };
  }
  if (t === "tool:end") {
    return {
      type: t,
      name,
      call_id,
      input_preview: previewToolPayload(callInput),
      output_preview: previewToolPayload(call?.output ?? call?.result ?? ev?.output ?? ev?.result),
    };
  }
  if (t === "tool:error") {
    return { type: t, name, call_id, error: previewToolPayload(ev?.error ?? ev?.message ?? call?.error ?? ev) };
  }
  if (t.startsWith("control:")) return ev;
  return { type: t, name, call_id };
}

export type ToolAuditEntry = {
  tool_name: string | null;
  call_id: string | null;
  args_preview: string;
  duration_ms: number | null;
  approval_decision: string | null;
  tool_schema_version: number | null;
  tool_schema_sha256: string | null;
  sandbox_ref: string | null;
  cost_usd: number | null;
  status: "completed" | "error";
};

export function recordToolAuditOnEndLike(
  ev: unknown,
  kind: "end" | "error",
  ctx: {
    toolStartAtByCallId: Map<string, number>;
    approvalDecisionByCallId: Map<string, string>;
    toolSchemaRefByCallId: Map<string, { version: number | null; schema_sha256: string | null }>;
  }
): ToolAuditEntry {
  const tool_name = normalizeToolName(ev) || null;
  const call_id = normalizeCallId(ev) || null;
  const now = Date.now();
  const startedAt = call_id ? ctx.toolStartAtByCallId.get(call_id) : undefined;
  const duration_ms = startedAt != null ? Math.max(0, now - startedAt) : null;
  const approval_decision = call_id ? ctx.approvalDecisionByCallId.get(call_id) ?? null : null;
  const e = ev as Record<string, unknown>;
  const args_preview =
    kind === "error"
      ? argsPreview(e?.input ?? e?.args ?? e?.meta ?? null)
      : argsPreview(e?.input ?? e?.args ?? null);
  let schema_version: number | null = null;
  let schema_sha256: string | null = null;
  if (call_id && ctx.toolSchemaRefByCallId.has(call_id)) {
    const ref = ctx.toolSchemaRefByCallId.get(call_id);
    schema_version = ref?.version ?? null;
    schema_sha256 = ref?.schema_sha256 ?? null;
  }
  return {
    tool_name,
    call_id,
    args_preview: args_preview || "",
    duration_ms,
    approval_decision,
    tool_schema_version: schema_version,
    tool_schema_sha256: schema_sha256,
    sandbox_ref: null,
    cost_usd: null,
    status: kind === "error" ? "error" : "completed",
  };
}

export class ToolEventCollector {
  readonly events: Record<string, unknown>[] = [];
  readonly audit: ToolAuditEntry[] = [];
  readonly toolStartAtByCallId = new Map<string, number>();
  readonly approvalDecisionByCallId = new Map<string, string>();
  readonly toolSchemaRefByCallId = new Map<string, { version: number | null; schema_sha256: string | null }>();

  push(e: unknown): void {
    this.events.push(normalizeToolEvent(e));
    if (this.events.length > MAX_TOOL_EVENTS) {
      this.events.splice(0, this.events.length - MAX_TOOL_EVENTS);
    }
  }

  recordEndLike(ev: unknown, kind: "end" | "error"): void {
    this.audit.push(
      recordToolAuditOnEndLike(ev, kind, {
        toolStartAtByCallId: this.toolStartAtByCallId,
        approvalDecisionByCallId: this.approvalDecisionByCallId,
        toolSchemaRefByCallId: this.toolSchemaRefByCallId,
      })
    );
  }
}
