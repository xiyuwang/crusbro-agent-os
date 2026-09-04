import { toolRequiresApproval, type ToolsGateV10 } from "../framework/tools-gate-resolver";
import type { SideEffectClass } from "./types";

export class OutboundFrozenError extends Error {
  readonly code = "outbound_frozen";
  constructor(toolName: string) {
    super(`outbound tool frozen without HITL: ${toolName}`);
    this.name = "OutboundFrozenError";
  }
}

export function isOutboundTool(
  toolName: string,
  sideEffectClass: Record<string, SideEffectClass> = {}
): boolean {
  const n = String(toolName || "").trim();
  if (sideEffectClass[n] === "outbound") return true;
  if (n.startsWith("external_webhook")) return true;
  return false;
}

/** Merge tools_gate.require_approval with outbound side-effect classes. */
export function effectiveRequireApprovalTools(
  toolNames: string[],
  gateRaw: unknown,
  sideEffectClass: Record<string, SideEffectClass> = {}
): string[] {
  const set = new Set<string>();
  for (const n of toolNames) {
    if (toolRequiresApproval(n, gateRaw) || isOutboundTool(n, sideEffectClass)) {
      set.add(n);
    }
  }
  const gate = gateRaw as ToolsGateV10 | null;
  for (const n of gate?.require_approval ?? []) set.add(String(n));
  return [...set];
}

export function assertOutboundAllowed(opts: {
  toolName: string;
  approvalToken?: string | null;
  approved?: boolean;
  gateRaw?: unknown;
  sideEffectClass?: Record<string, SideEffectClass>;
}): void {
  const need =
    toolRequiresApproval(opts.toolName, opts.gateRaw) ||
    isOutboundTool(opts.toolName, opts.sideEffectClass);
  if (!need) return;
  if (opts.approved || String(opts.approvalToken || "").trim()) return;
  throw new OutboundFrozenError(opts.toolName);
}
