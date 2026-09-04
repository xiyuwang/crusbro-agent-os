import { z } from "zod";
import type { SideEffectClass } from "../harness/types";

const jsonSchemaLoose = z.record(z.string(), z.unknown());

export const httpToolSpecSchema = z.object({
  kind: z.literal("http"),
  name: z.string().min(1),
  description: z.string().optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  auth_env: z.string().optional(),
  input_schema: jsonSchemaLoose.optional(),
  side_effect: z.enum(["read", "write_workspace", "outbound"]).default("outbound"),
  require_approval: z.boolean().optional(),
});

export const jsToolSpecSchema = z.object({
  kind: z.literal("js"),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Relative path inside generated project, e.g. host-tools/foo.js */
  source_path: z.string().min(1),
  input_schema: jsonSchemaLoose.optional(),
  side_effect: z.enum(["read", "write_workspace", "outbound"]).default("write_workspace"),
  require_approval: z.boolean().optional(),
});

export const builtinToolRefSchema = z.object({
  kind: z.literal("builtin"),
  name: z.string().min(1),
  side_effect: z.enum(["read", "write_workspace", "outbound"]).optional(),
});

export const hostRefToolSpecSchema = z.object({
  kind: z.literal("host_ref"),
  name: z.string().min(1),
  side_effect: z.enum(["read", "write_workspace", "outbound"]).optional(),
});

export const toolSpecSchema = z.discriminatedUnion("kind", [
  httpToolSpecSchema,
  jsToolSpecSchema,
  builtinToolRefSchema,
  hostRefToolSpecSchema,
]);

const llmSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  base_url: z.string().optional(),
  api_key_env: z.string().default("LLM_API_KEY"),
});

const gatesSchema = z
  .object({
    tools_gate: z.unknown().optional(),
  })
  .passthrough();

const writePolicySchema = z.object({
  allowRelativePrefixes: z.array(z.string()).optional(),
  denyAbsolute: z.boolean().optional(),
});

const notifyEmitSchema = z.object({
  enabled: z.boolean().optional(),
  standard_tool: z.string().optional(),
  intent_prefix: z.string().optional(),
  payload_field_allowlist: z.array(z.string()).optional(),
});

/** AgentCatalog v1（兼容；含 orchestration） */
export const agentCatalogSchema = z.object({
  schema_version: z.string().default("1.0"),
  system_prompt: z.string().min(1),
  llm: llmSchema,
  skill_roots: z.array(z.string()).optional(),
  tools: z.array(toolSpecSchema).default([]),
  tools_gate: z.unknown().optional(),
  orchestration: z.record(z.string(), z.unknown()).optional(),
  contract: z.record(z.string(), z.unknown()).optional(),
});

/** AgentCatalog v2（不含 orchestration；gates / notify_emit 独立） */
export const agentCatalogV2Schema = z.object({
  schema_version: z.literal("2.0"),
  system_prompt: z.string().min(1),
  llm: llmSchema,
  skill_roots: z.array(z.string()).optional(),
  tools: z.array(toolSpecSchema).default([]),
  gates: gatesSchema.optional(),
  write_policy: writePolicySchema.optional(),
  notify_emit: notifyEmitSchema.optional(),
  contract: z.record(z.string(), z.unknown()).optional(),
});

export type AgentCatalog = z.infer<typeof agentCatalogSchema>;
export type AgentCatalogV2 = z.infer<typeof agentCatalogV2Schema>;
export type ToolSpec = z.infer<typeof toolSpecSchema>;

export type CatalogValidation =
  | { ok: true; catalog: AgentCatalog | AgentCatalogV2; schemaVersion: "1.0" | "2.0" }
  | { ok: false; errors: string[] };

function validateToolNames(tools: { name: string }[]): string | null {
  const names = tools.map((t) => t.name);
  if (new Set(names).size !== names.length) return "duplicate tool name";
  return null;
}

export function validateCatalog(raw: unknown): CatalogValidation {
  const ver =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? String((raw as Record<string, unknown>).schema_version || "1.0")
      : "1.0";

  if (ver === "2.0") {
    const parsed = agentCatalogV2Schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    const dup = validateToolNames(parsed.data.tools);
    if (dup) return { ok: false, errors: [dup] };
    return { ok: true, catalog: parsed.data, schemaVersion: "2.0" };
  }

  const parsed = agentCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const dup = validateToolNames(parsed.data.tools);
  if (dup) return { ok: false, errors: [dup] };
  return { ok: true, catalog: parsed.data, schemaVersion: "1.0" };
}

export function sideEffectMapFromCatalog(catalog: AgentCatalog | AgentCatalogV2): Record<string, SideEffectClass> {
  const out: Record<string, SideEffectClass> = {};
  for (const t of catalog.tools) {
    if (t.kind === "builtin" || t.kind === "host_ref") {
      if (t.side_effect) out[t.name] = t.side_effect;
    } else if (t.side_effect) {
      out[t.name] = t.side_effect;
    }
  }
  return out;
}

export function toolsGateFromCatalog(catalog: AgentCatalog | AgentCatalogV2): Record<string, unknown> {
  const requireApproval = catalog.tools
    .filter((t) => t.kind !== "builtin" && t.kind !== "host_ref" && t.require_approval)
    .map((t) => t.name);
  const fromDoc =
    "gates" in catalog && catalog.gates?.tools_gate && typeof catalog.gates.tools_gate === "object"
      ? (catalog.gates.tools_gate as Record<string, unknown>)
      : "tools_gate" in catalog && catalog.tools_gate && typeof catalog.tools_gate === "object"
        ? (catalog.tools_gate as Record<string, unknown>)
        : {};
  const existing = Array.isArray(fromDoc.require_approval)
    ? fromDoc.require_approval.map(String)
    : [];
  return {
    ...fromDoc,
    require_approval: [...new Set([...existing, ...requireApproval])],
  };
}
