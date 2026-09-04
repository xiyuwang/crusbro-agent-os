/** tools_gate 解析与工具名过滤（框架层，bundle 无关）。 */

export type ToolsGateV10 = {
  schema_version?: string;
  allowlist?: string[];
  denylist?: string[];
  require_approval?: string[];
  requireApproval?: string[];
};

function asGate(raw: unknown): ToolsGateV10 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as ToolsGateV10;
}

function normNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
}

export function parseToolsGate(raw: unknown): ToolsGateV10 | null {
  if (Array.isArray(raw)) {
    const allow = normNames(raw);
    return allow.length ? { schema_version: "1.0", allowlist: allow } : null;
  }
  const gate = asGate(raw);
  if (!gate) return null;
  return {
    schema_version: gate.schema_version ?? "1.0",
    allowlist: normNames(gate.allowlist),
    denylist: normNames(gate.denylist),
    require_approval: normNames(gate.require_approval ?? gate.requireApproval),
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function toolsGateFromManifestOrSnapshot(
  manifest: unknown,
  configSnapshot: unknown
): ToolsGateV10 | null {
  const cfg = asRecord(configSnapshot);
  if (cfg?.tools_gate != null) return parseToolsGate(cfg.tools_gate);
  const man = asRecord(manifest);
  if (man?.tools_gate != null) return parseToolsGate(man.tools_gate);
  return null;
}

export function filterToolNames(toolNames: string[], gateRaw: unknown): string[] {
  const names = [...new Set(toolNames.map((t) => String(t).trim()).filter(Boolean))];
  const gate = parseToolsGate(gateRaw);
  if (!gate) return names;

  let out = names;
  const allow = gate.allowlist ?? [];
  if (allow.length > 0) {
    const allowSet = new Set(allow);
    out = out.filter((t) => allowSet.has(t));
  }
  const deny = new Set(gate.denylist ?? []);
  if (deny.size > 0) {
    out = out.filter((t) => !deny.has(t));
  }
  return out;
}

export function toolRequiresApproval(toolName: string, gateRaw: unknown): boolean {
  const gate = parseToolsGate(gateRaw);
  if (!gate) return false;
  const want = String(toolName || "").trim();
  return (gate.require_approval ?? []).includes(want);
}

export function resolveRequireApprovalTools(gateRaw: unknown): string[] {
  const gate = parseToolsGate(gateRaw);
  return gate?.require_approval ?? [];
}

export function resolveEffectiveAllowSet(allTools: string[], gateRaw: unknown): Set<string> | null {
  const filtered = filterToolNames(allTools, gateRaw);
  const gate = parseToolsGate(gateRaw);
  if (!gate) return null;
  if ((gate.allowlist ?? []).length === 0 && (gate.denylist ?? []).length === 0) {
    return null;
  }
  return new Set(filtered);
}
