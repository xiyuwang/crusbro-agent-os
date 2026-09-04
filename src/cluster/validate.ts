import { z } from "zod";
import { validateRoutingIntegrity } from "./routing.js";

const memberSchema = z.object({
  agent_key: z.string().min(1),
  role: z.string().min(1),
  catalog_ref: z.string().optional(),
});

const routingEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  intents: z.array(z.string().min(1)).min(1),
});

const invariantsSchema = z
  .object({
    zero_tool_turn_forbidden: z.boolean().optional(),
    contract_notify_required: z.boolean().optional(),
    min_tool_ends: z
      .array(
        z.object({
          role: z.string().min(1),
          min: z.number().int().min(0),
        })
      )
      .optional(),
  })
  .passthrough();

export const clusterManifestSchema = z.object({
  schema_version: z.literal("1.0"),
  members: z.array(memberSchema).min(1),
  routing: z.array(routingEdgeSchema).optional(),
  invariants: invariantsSchema.optional(),
  concurrency: z
    .object({
      max_active_sessions_per_scope: z.number().int().min(1).optional(),
      scope_keys: z.array(z.string()).optional(),
    })
    .optional(),
  notify: z
    .object({
      envelope_version: z.string().optional(),
      standard_tool: z.string().optional(),
    })
    .optional(),
  finalize_when_idle: z.record(z.string(), z.unknown()).optional(),
  coordinator: z.record(z.string(), z.unknown()).optional(),
  hints: z.record(z.string(), z.unknown()).optional(),
});

export type ClusterManifest = z.infer<typeof clusterManifestSchema>;

export type ClusterValidation =
  | { ok: true; manifest: ClusterManifest }
  | { ok: false; errors: string[] };

export function validateClusterManifest(raw: unknown): ClusterValidation {
  const parsed = clusterManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const manifest = parsed.data;
  const errors: string[] = [];

  const keys = manifest.members.map((m) => m.agent_key.trim().toLowerCase());
  if (new Set(keys).size !== keys.length) {
    errors.push("duplicate agent_key in members");
  }

  errors.push(...validateRoutingIntegrity(manifest));

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest };
}

export function minToolEndsForRole(manifest: ClusterManifest, role: string): number {
  const inv = manifest.invariants;
  if (!inv?.min_tool_ends) return 0;
  const hit = inv.min_tool_ends.find((m) => m.role === role);
  return hit?.min ?? 0;
}

export function clusterInvariantFlags(manifest: ClusterManifest): {
  zeroToolTurnForbidden: boolean;
  contractNotifyRequired: boolean;
} {
  return {
    zeroToolTurnForbidden: manifest.invariants?.zero_tool_turn_forbidden ?? true,
    contractNotifyRequired: manifest.invariants?.contract_notify_required ?? true,
  };
}
