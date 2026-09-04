/**
 * Notify 幂等键规范化（cluster 模块统一入口）。
 * 规范格式：`n1|{runId}|{from}|{to}|{intent}|{bare}`
 */
const CANON_PREFIX = "n1|";

function normPart(raw: unknown, fallback = ""): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s || fallback;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractNotifyIdempotencyBareKey(runId: string, rawKey: string | null | undefined): string {
  const rid = String(runId || "").trim();
  let key = String(rawKey || "").trim();
  if (!key) return "";

  if (key.startsWith(CANON_PREFIX)) {
    const parts = key.split("|");
    if (parts.length >= 6 && parts[1] === rid) {
      return parts.slice(5).join("|");
    }
    if (parts.length >= 6) {
      return parts.slice(5).join("|") || key;
    }
  }

  if (rid) {
    const colon = new RegExp(`^${escapeRegExp(rid)}:`);
    const slash = new RegExp(`^${escapeRegExp(rid)}/`);
    if (colon.test(key)) return key.replace(colon, "");
    if (slash.test(key)) return key.replace(slash, "");
  }

  return key;
}

export type NormalizeNotifyIdempotencyInput = {
  runId: string;
  fromAgent: string;
  toAgent: string;
  intent: string;
  rawKey?: string | null;
  contentFingerprint?: string;
};

export function normalizeNotifyIdempotencyKey(input: NormalizeNotifyIdempotencyInput): string {
  const runId = String(input.runId || "").trim();
  const fromAgent = normPart(input.fromAgent, "unknown");
  const toAgent = normPart(input.toAgent, "unknown");
  const intent = String(input.intent || "").trim() || "unknown";
  if (!runId) return String(input.rawKey || "").trim();

  let bare = extractNotifyIdempotencyBareKey(runId, input.rawKey);
  if (!bare) {
    bare = String(input.contentFingerprint || "").trim();
  }
  if (!bare) return "";

  return `${CANON_PREFIX}${runId}|${fromAgent}|${toAgent}|${intent}|${bare}`;
}

/** @deprecated use normalizeNotifyIdempotencyKey */
export function scopeIdempotencyKeyToRun(runId: string, rawKey: string | null | undefined): string {
  const bare = extractNotifyIdempotencyBareKey(runId, rawKey);
  if (!bare) return "";
  return `${runId}:${bare}`;
}
