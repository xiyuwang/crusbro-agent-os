/** LLM pool helpers: purpose routing + provider fallback (e.g. minimax 429 → qwen). */

const s = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

export function llmEntryToDict(entry: Record<string, unknown>): Record<string, unknown> {
  let baseUrl = s(entry.base_url);
  if (baseUrl.toLowerCase().includes("dashscope") && /\/chat\/completions\/?$/i.test(baseUrl)) {
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/i, "");
  }
  const out: Record<string, unknown> = {
    provider: s(entry.provider) || "openai_compatible",
    base_url: baseUrl,
    api_key: s(entry.api_key),
    model: s(entry.model),
    api: s(entry.api),
  };
  const eb = entry.extra_body;
  if (eb && typeof eb === "object" && !Array.isArray(eb)) {
    out.extra_body = { ...(eb as Record<string, unknown>) };
  }
  return out;
}

export function llmDictFromPoolDoc(doc: unknown, purpose?: string): Record<string, unknown> {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
  const pool = doc as Record<string, unknown>;
  const entries = pool.entries;
  if (!Array.isArray(entries) || entries.length === 0) return {};
  const byId = new Map<string, Record<string, unknown>>();
  for (const e of entries) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const row = e as Record<string, unknown>;
    const id = s(row.id);
    if (!id) continue;
    byId.set(id, row);
  }
  const defId = s(pool.default_entry_id);
  const want = s(purpose).toLowerCase();

  let entry: Record<string, unknown> | undefined;
  if (want) {
    for (const e of entries) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      const row = e as Record<string, unknown>;
      const t = s(row.api_type).toLowerCase();
      if (!t || t !== want) continue;
      if (s(row.api_key) && s(row.model)) {
        entry = row;
        break;
      }
    }
  }
  if (!entry) entry = defId ? byId.get(defId) : undefined;
  if (!entry) {
    const first = entries[0];
    entry = first && typeof first === "object" && !Array.isArray(first) ? (first as Record<string, unknown>) : undefined;
  }
  if (!entry) return {};
  return llmEntryToDict(entry);
}

export function mergeLlmConfigFromUserConfigs(
  userConfigs: Record<string, unknown>,
  purpose?: string
): Record<string, unknown> {
  const fromPool = llmDictFromPoolDoc(userConfigs["llm.pool.v1"], purpose);
  const poolOk = Boolean(s(fromPool.api_key) && s(fromPool.model));
  if (poolOk) return fromPool;

  const d = userConfigs["llm.defaults.v1"];
  if (!d || typeof d !== "object" || Array.isArray(d)) return {};
  const o = d as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["base_url", "model", "api_key", "api", "provider"]) {
    if (o[k] != null && o[k] !== "") out[k] = o[k];
  }
  const eb = o.extra_body;
  if (eb && typeof eb === "object" && !Array.isArray(eb)) {
    out.extra_body = { ...(eb as Record<string, unknown>) };
  }
  return out;
}

/** True when upstream LLM returned 429 / quota / usage limit style errors. */
export function isLlmRateLimitedMessage(msg: string): boolean {
  const m = String(msg || "").trim();
  const low = m.toLowerCase();
  if (!low) return false;
  if (
    low.includes("429") &&
    (low.includes("rate_limit") ||
      low.includes("usage limit") ||
      low.includes("quota") ||
      low.includes("限流") ||
      low.includes("token plan"))
  ) {
    return true;
  }
  if (low.includes("insufficient") && low.includes("quota")) return true;
  return false;
}

/** Retry pool fallback when primary stream produced no tools and the model step failed. */
export function isLlmRetryableProviderError(msg: string): boolean {
  if (isLlmRateLimitedMessage(msg)) return true;
  const low = String(msg || "").trim().toLowerCase();
  if (!low) return false;
  if (low.includes("http 404") || low.includes("model_not_found") || low.includes("invalid model")) return true;
  if (low.includes("http 401") || low.includes("http 403")) return true;
  if (low.includes("http 500") || low.includes("http 502") || low.includes("http 503")) return true;
  return low.includes("llm http");
}

const DEFAULT_FALLBACK_PROVIDERS = ["qwen", "deepseek", "openai", "glm", "kimi"];

function poolEntries(doc: unknown): Record<string, unknown>[] {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const entries = (doc as Record<string, unknown>).entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter((e) => e && typeof e === "object" && !Array.isArray(e)) as Record<string, unknown>[];
}

function cfgUsable(cfg: Record<string, unknown>): boolean {
  return Boolean(s(cfg.api_key) && s(cfg.model));
}

function sameLlmEndpoint(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return (
    s(a.provider).toLowerCase() === s(b.provider).toLowerCase() &&
    s(a.model).toLowerCase() === s(b.model).toLowerCase() &&
    s(a.base_url).toLowerCase() === s(b.base_url).toLowerCase()
  );
}

/**
 * Pick the next usable pool entry when the current provider is rate-limited.
 * Prefers providers in `preferProviders` order (default: qwen first).
 */
export function findLlmPoolFallback(
  userConfigs: Record<string, unknown>,
  currentCfg: Record<string, unknown>,
  preferProviders: string[] = DEFAULT_FALLBACK_PROVIDERS
): Record<string, unknown> | null {
  const entries = poolEntries(userConfigs["llm.pool.v1"]);
  if (entries.length === 0) return null;

  const prefer = preferProviders.map((p) => p.toLowerCase());
  const currentProv = s(currentCfg.provider).toLowerCase();

  const candidates: Record<string, unknown>[] = [];
  for (const prov of prefer) {
    for (const e of entries) {
      if (s(e.provider).toLowerCase() !== prov) continue;
      const dict = llmEntryToDict(e);
      if (!cfgUsable(dict)) continue;
      if (sameLlmEndpoint(dict, currentCfg)) continue;
      candidates.push(dict);
    }
    if (candidates.length > 0) break;
  }

  if (candidates.length === 0) {
    for (const e of entries) {
      const dict = llmEntryToDict(e);
      if (!cfgUsable(dict)) continue;
      if (sameLlmEndpoint(dict, currentCfg)) continue;
      candidates.push(dict);
    }
  }

  if (candidates.length === 0) return null;
  const picked = candidates[0]!;
  logFallbackPick(currentProv, s(picked.provider), s(picked.model));
  return picked;
}

function logFallbackPick(fromProv: string, toProv: string, toModel: string) {
  try {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: "info",
        event: "llm_pool.fallback_pick",
        from_provider: fromProv,
        to_provider: toProv,
        to_model: toModel,
      })
    );
  } catch {
    /* ignore */
  }
}
