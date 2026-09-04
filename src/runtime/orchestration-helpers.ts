/**
 * Generic orchestration helpers: config_snapshot / contract / tool-floor / early-exit.
 * Media-specific publish settlement stays in the host.
 */

export function configSnapshot(input: unknown): Record<string, unknown> | null {
  const cfg = (input as any)?.config_snapshot;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : null;
}

/** Agent 是否启用 notify 能力（catalog.notify_emit；缺省视为开启）。 */
export function agentNotifyEmitEnabled(input: unknown): boolean {
  const cfg = configSnapshot(input);
  const ne = cfg?.notify_emit;
  if (ne && typeof ne === "object" && !Array.isArray(ne)) {
    if ((ne as Record<string, unknown>).enabled === false) return false;
  }
  return true;
}

export function configAgentType(input: unknown): string {
  return String(configSnapshot(input)?.agent_type || "").trim().toLowerCase();
}

export function configAgentKey(input: unknown, templateId: string): string {
  const k = String(configSnapshot(input)?.agent_key || "").trim();
  return k || String(templateId || "").trim() || "agent";
}

export function isOrchestratorManager(templateId: string, input: unknown): boolean {
  if (configAgentType(input) === "manager") return true;
  return String(templateId || "").trim().toLowerCase() === "manager";
}

export function contractRequiredInputPaths(input: unknown): string[] {
  const c = configSnapshot(input)?.contract as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return [];
  const req = c.required_inputs;
  if (!Array.isArray(req)) return [];
  const out: string[] = [];
  for (const r of req) {
    if (r && typeof r === "object" && !Array.isArray(r)) {
      const p = String((r as any).path || "").trim();
      if (p) out.push(p);
    }
  }
  return out;
}

export function contractOutputKinds(input: unknown): string[] {
  const c = configSnapshot(input)?.contract as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return [];
  const outs = c.outputs;
  if (!Array.isArray(outs)) return [];
  const kinds: string[] = [];
  for (const o of outs) {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const k = String((o as any).kind || "").trim();
      if (k) kinds.push(k);
    }
  }
  return kinds;
}

export function contractOutputFilenames(input: unknown): string[] {
  const c = configSnapshot(input)?.contract as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return [];
  const outs = c.outputs;
  if (!Array.isArray(outs)) return [];
  const names: string[] = [];
  for (const o of outs) {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const f = String((o as any).filename || "").trim();
      if (f) names.push(f);
    }
  }
  return names;
}

export function contractRecommendedTools(input: unknown): string[] {
  const c = configSnapshot(input)?.contract as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return [];
  const rt = c.recommended_tools;
  if (!Array.isArray(rt)) return [];
  const out: string[] = [];
  for (const t of rt) {
    const n = String(t || "").trim();
    if (n) out.push(n);
  }
  return out;
}

function contractDeliverableFilenamesHint(input: unknown): string {
  const names = contractOutputFilenames(input);
  return names.length > 0 ? names.join("、") : "contract.outputs 声明的产物文件";
}

export function workerPrimaryZeroToolFollowupMessage(input: unknown): string {
  const deliverables = contractDeliverableFilenamesHint(input);
  const recommended = contractRecommendedTools(input);
  const recLine =
    recommended.length > 0 ? `- 可选工具（视素材来源，非强制）：${recommended.join("、")}\n` : "";
  const toolHint =
    recommended.length > 0 ? recommended.join("、") : "contract.recommended_tools 或 artifact.write 等允许的工具";
  return (
    "[系统强制] 你是 Worker，禁止零工具结束。请立刻调用至少一个工具并完成交付：\n" +
    recLine +
    `- 必须落盘：${deliverables}（推荐工具：${toolHint}）\n` +
    "- 然后必须 agent.notify 回 Manager（intent 取自 contract.next_notifies[0]）。\n" +
    "不要解释，只要工具调用。"
  );
}

export function workerSecondaryZeroToolFollowupMessage(input: unknown): string {
  const deliverables = contractDeliverableFilenamesHint(input);
  const recommended = contractRecommendedTools(input);
  const recLine =
    recommended.length > 0 ? `推荐工具：${recommended.join("、")}；` : "请使用 contract 允许的工具；";
  return (
    "[系统强制] 未检测到任何 tool:end。你必须立刻调用工具完成交付，不要只输出文本。\n" +
    `${recLine}至少完成 contract.outputs 产物（${deliverables}）并 agent.notify 回 Manager（contract.next_notifies[0].intent）。`
  );
}

/**
 * 产物工具已跑过，但缺契约 agent.notify 回执时的强制跟进（与 Manager 派发缺口 follow-up 对称）。
 * 文案只引用 contract.next_notifies / failure_notify，不点名业态 intent。
 */
export function workerContractNotifyFollowupMessage(input: unknown): string {
  const nn = contractFirstNextNotify(input);
  const failure = contractFailureNotify(input);
  const okIntent = nn?.intent || "(contract.next_notifies[0].intent)";
  const toAgent = nn?.to_agent || "manager";
  const failHint = failure?.intent
    ? `若本阶段失败则 intent=${failure.intent}（to_agent=${failure.to_agent || "manager"}）。\n`
    : "";
  const deliverables = contractDeliverableFilenamesHint(input);
  return (
    "[系统强制·契约回执缺口] 本回合已有工具调用，但未检测到契约要求的 agent.notify 回执。\n" +
    `写盘（${deliverables}）≠ 交卷：必须立刻调用 agent.notify，to_agent=${toAgent}，intent=${okIntent}。\n` +
    failHint +
    "payload_json 至少含 run_id 与产物信息；禁止仅用自然语言结束。不要解释，只要工具调用。"
  );
}

export function contractRequiresTopicsArray(input: unknown): boolean {
  return contractRequiredInputPaths(input).includes("topics");
}

export function contractRequiresRankedTopics(input: unknown): boolean {
  return contractRequiredInputPaths(input).includes("ranked_topics");
}

export function contractRequiresSourcesAndBrief(input: unknown): boolean {
  const p = contractRequiredInputPaths(input);
  return p.includes("sources") && p.includes("brief");
}

export function contractRequiresBrief(input: unknown): boolean {
  return contractRequiredInputPaths(input).includes("brief");
}

export function contractRequiresScriptPath(input: unknown): boolean {
  return contractRequiredInputPaths(input).includes("script_path");
}

export function contractRequiresPublishPlan(input: unknown): boolean {
  return contractRequiredInputPaths(input).includes("publish_plan");
}

export function workerPrimaryToolFollowup(templateId: string, input: unknown): boolean {
  if (isOrchestratorManager(templateId, input)) return false;
  if (configAgentType(input) === "auditor") return false;
  return workerContractToolFloor(input);
}

export function workerContractToolFloor(input: unknown): boolean {
  if (configAgentType(input) === "auditor") return true;
  const paths = contractRequiredInputPaths(input);
  if (paths.includes("topics")) return true;
  if (paths.includes("ranked_topics")) return true;
  if (paths.includes("brief")) return true;
  if (paths.includes("sources") && paths.includes("brief")) return true;
  if (paths.includes("script_path")) return true;
  if (paths.includes("publish_plan")) return true;
  return false;
}

export function contractEnforcesSourcesOrScriptMaterial(input: unknown): boolean {
  if (contractRequiresSourcesAndBrief(input)) return true;
  return contractRequiresScriptPath(input) && contractOutputKinds(input).length > 0;
}

export function workerSecondaryToolEnforcement(templateId: string, input: unknown): boolean {
  if (isOrchestratorManager(templateId, input)) return false;
  if (configAgentType(input) === "auditor") return true;
  if (!workerContractToolFloor(input)) return false;
  if (contractRequiresPublishPlan(input)) return false;
  return true;
}

export function toolEventArgsPreview(raw: unknown): string {
  const e = raw as Record<string, unknown>;
  const call = e?.call as Record<string, unknown> | undefined;
  const candidates = [e?.input_preview, e?.output_preview, call?.input, call?.inputPreview, e?.input, e?.args, e?.arguments];
  for (const c of candidates) {
    if (c == null) continue;
    try {
      const s = typeof c === "string" ? c : JSON.stringify(c);
      if (s) return s;
    } catch {
      continue;
    }
  }
  return "";
}

export function countToolEndEvents(events: unknown[]): number {
  let n = 0;
  for (const e of events) {
    if (String((e as Record<string, unknown>)?.type || "") === "tool:end") n++;
  }
  return n;
}

export function workerContractNotifyIntentSeen(toolEvents: unknown[], intent: string): boolean {
  const needle = intent.trim();
  if (!needle) return false;
  for (const raw of toolEvents) {
    const e = raw as Record<string, unknown>;
    if (String(e?.name || "") !== "agent.notify") continue;
    const t = String(e?.type || "");
    if (t !== "tool:start" && t !== "tool:end") continue;
    const blob = toolEventArgsPreview(e);
    if (blob.includes(`"intent":"${needle}"`) || blob.includes(`"intent": "${needle}"`)) return true;
  }
  return false;
}

export function contractFailureNotify(input: unknown): { to_agent: string; intent: string } | null {
  const c = configSnapshot(input)?.contract as Record<string, unknown> | undefined;
  const fn = c?.failure_notify;
  if (!fn || typeof fn !== "object" || Array.isArray(fn)) return null;
  const intent = String((fn as Record<string, unknown>).intent || "").trim();
  if (!intent) return null;
  const to_agent = String((fn as Record<string, unknown>).to_agent || "manager").trim() || "manager";
  return { to_agent, intent };
}

export function workerContractNotifyComplete(input: unknown, toolEvents: unknown[]): boolean {
  if (!agentNotifyEmitEnabled(input)) return true;
  const nn = contractFirstNextNotify(input);
  if (!nn?.intent) return true;
  if (workerContractNotifyIntentSeen(toolEvents, nn.intent)) return true;
  const failure = contractFailureNotify(input);
  if (failure?.intent && workerContractNotifyIntentSeen(toolEvents, failure.intent)) return true;
  return false;
}

export function workerContractEarlyExitEligible(input: unknown, toolEvents: unknown[]): boolean {
  if (!workerContractToolFloor(input)) return false;
  if (!contractFirstNextNotify(input)?.intent) return false;
  return workerContractNotifyComplete(input, toolEvents);
}

function flattenClusterCoordinator(snapshot: Record<string, unknown>): Record<string, unknown> {
  const coord = snapshot.coordinator;
  if (coord && typeof coord === "object" && !Array.isArray(coord)) {
    return { ...snapshot, ...(coord as Record<string, unknown>) };
  }
  return snapshot;
}

function readOrchestrationConstraints(input: unknown): Record<string, unknown> | null {
  const inp = input as Record<string, unknown> | null | undefined;
  const clusterSnap = inp?.cluster_snapshot;
  if (clusterSnap && typeof clusterSnap === "object" && !Array.isArray(clusterSnap)) {
    return flattenClusterCoordinator(clusterSnap as Record<string, unknown>);
  }

  const cfg = configSnapshot(input);
  const orch = cfg?.orchestration;
  if (orch && typeof orch === "object" && !Array.isArray(orch)) return orch as Record<string, unknown>;
  const legacyCfg = cfg?.skill;
  if (legacyCfg && typeof legacyCfg === "object" && !Array.isArray(legacyCfg)) {
    return legacyCfg as Record<string, unknown>;
  }

  const snap = inp?.orchestration_snapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    return flattenClusterCoordinator(snap as Record<string, unknown>);
  }
  const legacySnap = inp?.skill_snapshot;
  if (legacySnap && typeof legacySnap === "object" && !Array.isArray(legacySnap)) {
    return legacySnap as Record<string, unknown>;
  }
  return null;
}

export function managerMinToolEnds(input: unknown): number {
  if (isManagerOrchestrationKickoff(input as Record<string, unknown>)) return 1;
  const constraints = readOrchestrationConstraints(input);
  const n = Number(constraints?.manager_notify_min_tool_ends);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const inp = input as Record<string, unknown> | null | undefined;
  const clusterSnap = inp?.cluster_snapshot;
  if (clusterSnap && typeof clusterSnap === "object" && !Array.isArray(clusterSnap)) {
    const inv = (clusterSnap as Record<string, unknown>).invariants;
    if (inv && typeof inv === "object" && !Array.isArray(inv)) {
      const minEnds = (inv as Record<string, unknown>).min_tool_ends;
      if (Array.isArray(minEnds)) {
        const hit = minEnds.find(
          (m) => m && typeof m === "object" && !Array.isArray(m) && (m as Record<string, unknown>).role === "coordinator"
        ) as Record<string, unknown> | undefined;
        const min = Number(hit?.min);
        if (Number.isFinite(min) && min > 0) return Math.floor(min);
      }
    }
  }
  return 1;
}

export function managerNotifyIntentRequiresToolFloor(input: unknown): boolean {
  const intent = String(
    (input as Record<string, unknown> | null | undefined)?.notify_intent ||
      (input as Record<string, unknown> | null | undefined)?.intent ||
      ""
  ).trim();
  if (!intent) return false;
  const constraints = readOrchestrationConstraints(input);
  const intents = constraints?.manager_notify_intents_tool_floor;
  if (!Array.isArray(intents)) return false;
  return intents.map((x) => String(x).trim()).includes(intent);
}

export function managerRequiresToolFloor(templateId: string, input: unknown): boolean {
  if (!isOrchestratorManager(templateId, input)) return false;
  if (isManagerOrchestrationKickoff(input as Record<string, unknown>)) return true;
  return managerNotifyIntentRequiresToolFloor(input);
}

export function isManagerOrchestrationKickoff(input: Record<string, unknown> | null | undefined): boolean {
  if (!input || typeof input !== "object") return false;
  const entry = String((input as any).entry || "").trim();
  const intent = String((input as any).notify_intent || (input as any).intent || "").trim();
  if (entry === "trigger" || entry === "run.entry") return true;
  if (intent.startsWith("trigger.") || intent === "run.entry") return true;
  if ((input as any).scheduled === true) return true;
  return false;
}

function parseNotifyIntentFromToolPreview(blob: string): string {
  if (!blob) return "";
  const m = blob.match(/"intent"\s*:\s*"([^"]+)"/);
  return m?.[1]?.trim() || "";
}

function parseNotifyToAgentFromToolPreview(blob: string): string {
  if (!blob) return "";
  const m = blob.match(/"to_agent"\s*:\s*"([^"]+)"/);
  return m?.[1]?.trim().toLowerCase() || "";
}

export function managerKickoffWorkerDispatchSeen(toolEvents: unknown[]): boolean {
  for (const raw of toolEvents) {
    const e = raw as Record<string, unknown>;
    const name = String(e?.name || "");
    if (name !== "agent.notify" && name !== "bg_task_run") continue;
    if (String(e?.type || "") !== "tool:end") continue;
    const blob = toolEventArgsPreview(e);
    const intent = parseNotifyIntentFromToolPreview(blob);
    if (!intent) continue;
    if (/\.(done|failed)$/i.test(intent)) continue;
    const toAgent = parseNotifyToAgentFromToolPreview(blob);
    if (toAgent === "manager") continue;
    return true;
  }
  return false;
}

export function managerKickoffEarlyExitEligible(templateId: string, input: unknown, toolEvents: unknown[]): boolean {
  if (!isOrchestratorManager(templateId, input)) return false;
  if (!isManagerOrchestrationKickoff(input as Record<string, unknown>)) return false;
  return managerKickoffWorkerDispatchSeen(toolEvents);
}

export type ManagerDispatchGap = {
  notifyIntent: string;
  missingIntents: string[];
};

function managerNotifyIntentKey(input: Record<string, unknown> | null | undefined): string {
  if (!input || typeof input !== "object") return "";
  if (isManagerOrchestrationKickoff(input)) return "run.entry";
  return String(input.notify_intent || input.intent || "").trim();
}

export function managerRunSetStatusFailedSeen(toolEvents: unknown[]): boolean {
  for (const raw of toolEvents) {
    const e = raw as Record<string, unknown>;
    if (String(e?.name || "") !== "run.set_status") continue;
    if (String(e?.type || "") !== "tool:end") continue;
    const blob = toolEventArgsPreview(e);
    if (blob.includes('"status":"failed"') || blob.includes('"status": "failed"')) return true;
  }
  return false;
}

export function managerNotifyIntentDispatched(toolEvents: unknown[], expectedIntent: string): boolean {
  const needle = String(expectedIntent || "").trim();
  if (!needle) return false;
  for (const raw of toolEvents) {
    const e = raw as Record<string, unknown>;
    if (String(e?.name || "") !== "agent.notify") continue;
    if (String(e?.type || "") !== "tool:end") continue;
    const blob = toolEventArgsPreview(e);
    const intent = parseNotifyIntentFromToolPreview(blob);
    if (intent === needle) return true;
  }
  return false;
}

export function managerRequiredWorkerDispatchIntents(input: unknown): string[] {
  const constraints = readOrchestrationConstraints(input);
  const map = constraints?.manager_required_worker_dispatch;
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const key = managerNotifyIntentKey(input as Record<string, unknown>);
  if (!key) return [];
  const required = (map as Record<string, unknown>)[key];
  if (Array.isArray(required)) {
    return required.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof required === "string" && required.trim()) return [required.trim()];
  return [];
}

/** Manager 回合结束但缺少 bundle orchestration 声明的下游 Worker 派发。 */
export function managerDispatchGap(
  templateId: string,
  input: unknown,
  toolEvents: unknown[]
): ManagerDispatchGap | null {
  if (!isOrchestratorManager(templateId, input)) return null;
  const inp = input as Record<string, unknown>;
  const notifyIntent = managerNotifyIntentKey(inp);
  if (!notifyIntent) return null;

  if (isManagerOrchestrationKickoff(inp)) {
    if (managerKickoffWorkerDispatchSeen(toolEvents)) return null;
    if (managerRunSetStatusFailedSeen(toolEvents)) return null;
    const required = managerRequiredWorkerDispatchIntents(input);
    if (required.length === 0) return null;
    const missing = required.filter((ri) => !managerNotifyIntentDispatched(toolEvents, ri));
    return missing.length > 0 ? { notifyIntent, missingIntents: missing } : null;
  }

  const required = managerRequiredWorkerDispatchIntents(input);
  if (required.length === 0) return null;
  const missing = required.filter((ri) => !managerNotifyIntentDispatched(toolEvents, ri));
  if (missing.length === 0) return null;
  return { notifyIntent, missingIntents: missing };
}

function readOrchestrationStringMap(input: unknown, key: string): Record<string, string> {
  const constraints = readOrchestrationConstraints(input);
  let raw = constraints?.[key];
  const inp = input as Record<string, unknown> | null | undefined;
  const clusterRoot =
    inp?.cluster_snapshot && typeof inp.cluster_snapshot === "object" && !Array.isArray(inp.cluster_snapshot)
      ? (inp.cluster_snapshot as Record<string, unknown>)
      : inp?.orchestration_snapshot && typeof inp.orchestration_snapshot === "object" && !Array.isArray(inp.orchestration_snapshot)
        ? (inp.orchestration_snapshot as Record<string, unknown>)
        : null;
  if ((!raw || typeof raw !== "object" || Array.isArray(raw)) && clusterRoot?.hints && typeof clusterRoot.hints === "object") {
    const hints = clusterRoot.hints as Record<string, unknown>;
    if (key === "manager_intent_followup_hints" && hints.coordinator && typeof hints.coordinator === "object") {
      raw = hints.coordinator;
    }
    if (key === "manager_dispatch_followup_hints" && hints.dispatch && typeof hints.dispatch === "object") {
      raw = hints.dispatch;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** 从 bundle orchestration.manager_intent_followup_hints 读取 intent 提示（框架通用，文案在 bundle）。 */
export function managerToolFollowupMessage(input?: Record<string, unknown> | null): string {
  const intent = managerNotifyIntentKey(input ?? undefined);
  const hints = readOrchestrationStringMap(input, "manager_intent_followup_hints");
  const intentHint = hints[intent] ? `${hints[intent]}\n` : "";
  return (
    "[系统强制·第二轮] 上一轮 tool:end 不足。你是 OPC Manager：禁止仅用纯文本结束。\n" +
    intentHint +
    "你必须立刻调用至少一种工具（例如 agent.notify / artifact.write / run.append_note / todo_write / run.set_status）。\n" +
    "禁止零工具结束；若确无法执行请 run.set_status=failed 并写明原因。"
  );
}

/** 从 bundle orchestration.manager_dispatch_followup_hints 读取派发缺口 follow-up 提示。 */
export function managerDispatchFollowupMessage(
  input: Record<string, unknown> | null | undefined,
  gap: { notifyIntent: string; missingIntents: string[] }
): string {
  const intent = String(gap?.notifyIntent || managerNotifyIntentKey(input ?? undefined) || "").trim();
  const missing = (gap?.missingIntents || []).join(", ");
  const hints = readOrchestrationStringMap(input, "manager_dispatch_followup_hints");
  const intentHint = hints[intent]
    ? `${hints[intent]}\n`
    : `必须 agent.notify 派发下游 Worker，intent 之一：${missing}。\n`;
  return (
    "[系统强制·派发缺口] 本回合 tool:end 已够，但未检测到必需的下游 Worker 派发。\n" +
    intentHint +
    "请立即调用 agent.notify（to_agent=对应 Worker，intent 见上）；禁止仅用 run.append_note/todo_write 结束。\n" +
    "若确实无法继续请 run.set_status=failed 并写明 error_code。"
  );
}

export type ResolveProcessingTimeoutOptions = {
  extraLongRunning?: (intent: string, input: unknown) => boolean;
  defaultMs?: number;
  longMs?: number;
};

export function resolveAgentProcessingTimeoutMs(input: unknown, opts: ResolveProcessingTimeoutOptions = {}): number {
  const defaultMs = Math.max(60_000, opts.defaultMs ?? Number(process.env.RUNTIME_PROCESSING_TIMEOUT_MS || 5 * 60 * 1000));
  const intent = String((input as Record<string, unknown>)?.notify_intent || (input as Record<string, unknown>)?.intent || "").trim();
  const isLong =
    intent.includes(".publish") ||
    intent.endsWith("publish") ||
    intent.endsWith(".done") ||
    contractRequiresPublishPlan(input) ||
    (opts.extraLongRunning?.(intent, input) ?? false);
  if (!isLong) return defaultMs;
  return Math.max(defaultMs, opts.longMs ?? Number(process.env.RUNTIME_PUBLISH_PROCESSING_TIMEOUT_MS || 20 * 60 * 1000));
}

export function resolveAgentToolTimeoutMs(input: unknown, notifyWallMs: number, opts?: ResolveProcessingTimeoutOptions): number {
  const envMs = Number(process.env.RUNTIME_TOOL_TIMEOUT_MS || 0);
  const floor = Math.max(120_000, Number.isFinite(envMs) && envMs > 0 ? envMs : 0);
  const wall = Math.max(60_000, notifyWallMs);
  const processing = resolveAgentProcessingTimeoutMs(input, opts);
  return Math.max(floor, Math.min(wall, processing));
}

export function contractFirstNextNotify(input: unknown): { to_agent: string; intent: string } | null {
  const c = configSnapshot(input)?.contract as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return null;
  const nn = c.next_notifies;
  if (!Array.isArray(nn) || nn.length === 0) return null;
  const first = nn[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const to_agent = String((first as any).to_agent || "manager").trim() || "manager";
  const intent = String((first as any).intent || "").trim();
  if (!intent) return null;
  return { to_agent, intent };
}

export function resolveTemplateDefaultLlmPurpose(
  templateId: string,
  input: unknown
): "plan" | "general" | "video" | "image" {
  const cfg = configSnapshot(input);
  const explicit = String(cfg?.llm_default_purpose || "").trim().toLowerCase();
  if (explicit === "plan" || explicit === "general" || explicit === "video" || explicit === "image") {
    return explicit as "plan" | "general" | "video" | "image";
  }
  if (isOrchestratorManager(templateId, input)) return "plan";
  const kinds = contractOutputKinds(input);
  if (kinds.some((k) => k.includes("video"))) return "video";
  if (kinds.some((k) => k.includes("image") || k.includes("cover"))) return "image";
  return "general";
}
