import type { ClusterManifest } from "./validate.js";

export type RoutingEdge = {
  from: string;
  to: string;
  intents: string[];
};

export function normalizeRouting(manifest: ClusterManifest): RoutingEdge[] {
  const raw = manifest.routing;
  if (!Array.isArray(raw)) return [];
  const out: RoutingEdge[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const from = String((r as RoutingEdge).from || "").trim();
    const to = String((r as RoutingEdge).to || "").trim();
    const intents = Array.isArray((r as RoutingEdge).intents)
      ? (r as RoutingEdge).intents.map((i) => String(i).trim()).filter(Boolean)
      : [];
    if (!from || !to || intents.length === 0) continue;
    out.push({ from, to, intents });
  }
  return out;
}

export function roleByAgentKey(manifest: ClusterManifest): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of manifest.members) {
    const key = String(m.agent_key || "").trim();
    const role = String(m.role || "").trim();
    if (key && role) map.set(key.toLowerCase(), role);
  }
  return map;
}

export function isRoutingAllowed(
  manifest: ClusterManifest,
  opts: { fromRole: string; toRole: string; intent: string }
): boolean {
  const edges = normalizeRouting(manifest);
  if (edges.length === 0) return true;
  const intent = String(opts.intent || "").trim();
  const fromRole = String(opts.fromRole || "").trim();
  const toRole = String(opts.toRole || "").trim();
  if (!intent || !fromRole || !toRole) return false;
  return edges.some(
    (e) => e.from === fromRole && e.to === toRole && e.intents.includes(intent)
  );
}

export function validateRoutingIntegrity(manifest: ClusterManifest): string[] {
  const errors: string[] = [];
  const roles = new Set(manifest.members.map((m) => String(m.role || "").trim()).filter(Boolean));
  const edges = normalizeRouting(manifest);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!roles.has(e.from)) errors.push(`routing[${i}].from role "${e.from}" not in members`);
    if (!roles.has(e.to)) errors.push(`routing[${i}].to role "${e.to}" not in members`);
    if (e.intents.length === 0) errors.push(`routing[${i}].intents must be non-empty`);
  }
  return errors;
}
