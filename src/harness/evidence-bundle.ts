import { createHash } from "node:crypto";

export type EvidenceEntry = {
  kind: string;
  at: string;
  data: Record<string, unknown>;
};

export type EvidenceBundle = {
  work_order_id: string;
  created_at: string;
  entries: EvidenceEntry[];
  hashes: Record<string, string>;
};

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function assembleEvidenceBundle(opts: {
  workOrderId: string;
  now?: Date;
  configSnapshot?: unknown;
  orchestrationSnapshot?: unknown;
  toolEvents?: Array<{ name?: string; input?: unknown; output?: unknown }>;
  artifactHashes?: Record<string, string>;
  approvalChain?: unknown[];
}): EvidenceBundle {
  const created = (opts.now ?? new Date()).toISOString();
  const entries: EvidenceEntry[] = [];
  if (opts.configSnapshot != null) {
    entries.push({ kind: "config_snapshot", at: created, data: { value: opts.configSnapshot } });
  }
  if (opts.orchestrationSnapshot != null) {
    entries.push({
      kind: "orchestration_snapshot",
      at: created,
      data: { value: opts.orchestrationSnapshot },
    });
  }
  for (const ev of opts.toolEvents ?? []) {
    entries.push({
      kind: "tool",
      at: created,
      data: {
        name: ev.name ?? null,
        input: ev.input ?? null,
        output_excerpt: ev.output ?? null,
      },
    });
  }
  if (opts.approvalChain?.length) {
    entries.push({ kind: "approval_chain", at: created, data: { chain: opts.approvalChain } });
  }
  return {
    work_order_id: String(opts.workOrderId),
    created_at: created,
    entries,
    hashes: { ...(opts.artifactHashes ?? {}) },
  };
}
