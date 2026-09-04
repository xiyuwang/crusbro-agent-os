/** Agent contract 解析与 payload 满足性检查（框架层，无业态硬编码）。 */

export type ContractInputSpec = {
  path?: string;
  type?: string;
  description?: string;
};

export type ContractOutputSpec = {
  kind?: string;
  filename?: string;
  description?: string;
};

export type AgentContract = {
  schema_version?: string;
  required_inputs?: ContractInputSpec[];
  outputs?: ContractOutputSpec[];
  [key: string]: unknown;
};

/** Host-supplied alias: return true/false to decide, or undefined to fall through. */
export type ContractPathAlias = (payload: Record<string, unknown>, path: string) => boolean | undefined;

const PLACEHOLDER_URL_HOSTS = new Set(["example.com"]);

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseContract(configSnapshot: unknown): AgentContract | null {
  const cfg = asObject(configSnapshot);
  if (!cfg) return null;
  const contract = asObject(cfg.contract);
  return contract as AgentContract | null;
}

export function contractFromManifestOrSnapshot(
  manifest: unknown,
  configSnapshot: unknown
): AgentContract | null {
  const fromCfg = parseContract(configSnapshot);
  if (fromCfg) return fromCfg;
  const man = asObject(manifest);
  if (!man) return null;
  const contract = asObject(man.contract);
  return contract as AgentContract | null;
}

export function contractRequiredPaths(configSnapshot: unknown): string[] {
  const contract = parseContract(configSnapshot);
  if (!contract) return [];
  const req = contract.required_inputs;
  if (!Array.isArray(req)) return [];
  const out: string[] = [];
  for (const r of req) {
    if (r && typeof r === "object") {
      const p = String((r as ContractInputSpec).path || "").trim();
      if (p) out.push(p);
    }
  }
  return out;
}

export function contractRequiredPathsFromPayload(payload: unknown): string[] {
  const obj = asObject(payload);
  const cfg = obj?.config_snapshot;
  return contractRequiredPaths(asObject(cfg));
}

export function payloadSatisfiesContractPath(
  payload: unknown,
  path: string,
  aliases: ContractPathAlias[] = []
): boolean {
  const p = String(path || "").trim();
  if (!p) return true;
  const obj = asObject(payload);
  if (!obj) return false;
  const val = obj[p];
  if (Array.isArray(val)) return val.length > 0;
  if (val && typeof val === "object") return Object.keys(val as object).length > 0;
  if (typeof val === "string" && val.trim()) return true;
  if (val != null && typeof val !== "string") return true;
  for (const alias of aliases) {
    const hit = alias(obj, p);
    if (hit !== undefined) return hit;
  }
  return false;
}

export function unsatisfiedContractPaths(
  payload: unknown,
  aliases: ContractPathAlias[] = []
): string[] {
  return contractRequiredPathsFromPayload(payload).filter(
    (path) => !payloadSatisfiesContractPath(payload, path, aliases)
  );
}

export function contractOutputFilename(configSnapshot: unknown, kind: string): string | null {
  const contract = parseContract(configSnapshot);
  if (!contract) return null;
  const outs = contract.outputs;
  if (!Array.isArray(outs)) return null;
  const want = String(kind || "").trim();
  for (const o of outs) {
    if (!o || typeof o !== "object") continue;
    const spec = o as ContractOutputSpec;
    if (String(spec.kind || "").trim() === want) {
      const fn = String(spec.filename || "").trim();
      if (fn) return fn;
    }
  }
  return null;
}

export function contractOutputFilenameFromPayload(payload: unknown, kind: string): string | null {
  const obj = asObject(payload);
  return contractOutputFilename(asObject(obj?.config_snapshot), kind);
}

export function artifactJsonHasPlaceholderUrls(
  jsonObj: unknown,
  arrayKeys: string[] = ["items"]
): boolean {
  const obj = asObject(jsonObj);
  if (!obj) return false;
  for (const key of arrayKeys) {
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      const row = asObject(it);
      if (!row) continue;
      const u = String(row.url || "").trim();
      if (!u) continue;
      let host = "";
      try {
        host = (new URL(u).hostname || "").toLowerCase();
      } catch {
        host = "";
      }
      if (PLACEHOLDER_URL_HOSTS.has(host)) return true;
    }
  }
  return false;
}

export function shouldRouteManagerChatNotifyToManager(
  toAgent: string,
  payload: unknown,
  aliases: ContractPathAlias[] = []
): boolean {
  if (String(toAgent || "").trim() === "manager") return false;
  return unsatisfiedContractPaths(payload, aliases).length > 0;
}
