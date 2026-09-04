export type SessionEventKind =
  | "tool_start"
  | "tool_end"
  | "tool_error"
  | "llm_usage"
  | "notify_out"
  | "hitl_block"
  | "session_start"
  | "session_end";

export type SessionEvent = {
  kind: SessionEventKind;
  ts: number;
  sessionId?: string;
  agentKey?: string;
  runId?: string;
  toolName?: string;
  callId?: string | null;
  detail?: Record<string, unknown>;
};

export type SessionEventHandler = (event: SessionEvent) => void | Promise<void>;

export function createSessionEvent(
  kind: SessionEventKind,
  detail?: Record<string, unknown>,
  meta?: Pick<SessionEvent, "sessionId" | "agentKey" | "runId" | "toolName" | "callId">
): SessionEvent {
  return {
    kind,
    ts: Date.now(),
    ...meta,
    detail,
  };
}
