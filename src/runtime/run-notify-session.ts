import type { AgentTemplateRegistry, ModelProvider, SandboxFactory, Store, ToolRegistry } from "../engine";
import { globalToolRegistry } from "../engine";
import { runWithExecutionContext } from "./execution-context.js";
import { runAgentSession } from "./run-agent-session.js";
import { buildNotifyUserContent, resolveRuntimeAgentId } from "./agent-id.js";
import {
  findLlmPoolFallback,
  isLlmRateLimitedMessage,
  isLlmRetryableProviderError,
} from "./llm-pool.js";
import { normalizeManagerToolChoiceForLlmCfg, resolveAgentLoopProviderFromLlmConfig } from "./agent-loop-provider.js";
import {
  contractFirstNextNotify,
  contractOutputFilenames,
  countToolEndEvents,
  isOrchestratorManager,
  managerDispatchGap,
  managerKickoffEarlyExitEligible,
  managerMinToolEnds,
  managerRequiresToolFloor,
  workerContractEarlyExitEligible,
  workerContractNotifyComplete,
  agentNotifyEmitEnabled,
  workerContractToolFloor,
  workerContractNotifyFollowupMessage,
  workerPrimaryToolFollowup,
  workerPrimaryZeroToolFollowupMessage,
  workerSecondaryToolEnforcement,
  workerSecondaryZeroToolFollowupMessage,
} from "./orchestration-helpers.js";
import { logDebug, logInfo, logWarn } from "./runtime-log.js";
import { normalizeCallId, normalizeToolName, ToolEventCollector } from "./tool-stream.js";

export type NotifySessionLoopCallbacks = {
  managerToolFollowupMessage: (input: Record<string, unknown>) => string;
  managerDispatchFollowupMessage?: (
    input: Record<string, unknown>,
    gap: { notifyIntent: string; missingIntents: string[] }
  ) => string;
  attachPermissionHandler?: (agent: unknown, collector: ToolEventCollector) => (() => void) | null;
  onToolStart?: (toolName: string, callId: string | null) => void;
  onToolEnd?: (toolName: string | null) => void;
  onToolError?: (toolName: string | null) => void;
  onTaskSnapshot?: () => void;
  resolveToolSchema?: (
    toolName: string,
    runId: string
  ) => Promise<{ version: number | null; schema_sha256: string | null } | null>;
  onPublishSettlement?: (toolEvents: unknown[]) => Promise<void>;
  reportWorkerGap?: (gap: {
    code: string;
    message: string;
    diagnostic: Record<string, unknown>;
    output: string;
    toolEvents: unknown[];
    toolAudit: unknown[];
  }) => Promise<boolean>;
  reportContractNotifyMissing?: (gap: {
    code: string;
    message: string;
    diagnostic: Record<string, unknown>;
    output: string;
    toolEvents: unknown[];
    toolAudit: unknown[];
  }) => Promise<boolean>;
};

export type RunNotifySessionParams = {
  notifyId: string;
  templateId: string;
  input: Record<string, unknown>;
  executionId: string;
  model: ModelProvider;
  llmCfgMerged: Record<string, unknown>;
  userConfigs: Record<string, unknown>;
  templateLlmPurpose: string;
  store: Store;
  toolRegistry: ToolRegistry;
  buildTemplateRegistry: (templateId: string, input: Record<string, unknown>) => Promise<AgentTemplateRegistry>;
  sandboxFactory: SandboxFactory;
  resolveProcessingTimeoutMs: (input: Record<string, unknown>) => number;
  resolveToolTimeoutMs: (input: Record<string, unknown>, notifyWallMs: number) => number;
  callbacks: NotifySessionLoopCallbacks;
};

export type NotifySessionResult = {
  completed: boolean;
  output: string;
  toolEvents: unknown[];
  toolAudit: unknown[];
  orchestrationGap?: { code: string; message: string; diagnostic?: Record<string, unknown> };
  crusbroAgentId?: string | null;
  managerToolFollowupUsed?: boolean;
  workerContractNotifyOk?: boolean;
  aborted?: boolean;
};

function classifyLlmMonitorFailure(msg: string): { code: string; message: string } {
  const m = String(msg || "").trim();
  if (isLlmRateLimitedMessage(m)) {
    return { code: "llm_rate_limited", message: m.slice(0, 1900) };
  }
  return { code: "llm_provider_error", message: m.slice(0, 1900) };
}

export async function runNotifySession(params: RunNotifySessionParams): Promise<NotifySessionResult> {
  const {
    notifyId,
    templateId: tpl,
    input,
    executionId,
    model,
    llmCfgMerged,
    userConfigs,
    templateLlmPurpose,
    store,
    toolRegistry,
    buildTemplateRegistry,
    sandboxFactory,
    resolveProcessingTimeoutMs,
    resolveToolTimeoutMs,
    callbacks,
  } = params;

  const resolvedToolRegistry = toolRegistry ?? globalToolRegistry;

  const runIdStr = String(input?.run_id || "").trim();
  const tenantIdStr = String(input?.tenant_id || "").trim();
  const opcIdStr2 = String(input?.opc_id || "").trim();

  const baseDefault: Record<string, unknown> = { ...llmCfgMerged };
  const purposes = ["general", "plan", "image", "video"];
  const llmByPurpose: Record<string, Record<string, unknown>> = { default: baseDefault };
  for (const p of purposes) {
    llmByPurpose[p] = { ...baseDefault };
  }

  return runWithExecutionContext(
    {
      run_id: runIdStr,
      notify_id: String(notifyId),
      execution_id: executionId,
      tenant_id: tenantIdStr || null,
      opc_id: opcIdStr2 || null,
      llm_default_purpose: templateLlmPurpose,
      llm_by_purpose: llmByPurpose,
      config_snapshot:
        input?.config_snapshot && typeof input.config_snapshot === "object" && !Array.isArray(input.config_snapshot)
          ? (input.config_snapshot as Record<string, unknown>)
          : null,
    },
    async () => {
      logInfo("notify_session.agent_loop_enter", {
        notify_id: notifyId,
        template_id: tpl,
        run_id: runIdStr || null,
      });

      const templateRegistry = await buildTemplateRegistry(tpl, input);
      const agentId = resolveRuntimeAgentId(tpl, input);
      const userContent = buildNotifyUserContent(notifyId, input, tpl);
      const timeoutMs = Math.max(
        5_000,
        Math.min(30 * 60 * 1000, Number(process.env.RUNTIME_TASK_TIMEOUT_MS || 20 * 60 * 1000))
      );
      const toolTimeoutMs = resolveToolTimeoutMs(input, timeoutMs);
      const maxToolCalls = Math.max(1, Math.min(2000, Number(process.env.RUNTIME_MAX_TOOL_CALLS || 250)));

      let agent2 = await runAgentSession(
        {
          templateId: tpl,
          model,
          ...(agentId ? { agentId } : {}),
          metadata: {
            processingTimeoutMs: resolveProcessingTimeoutMs(input),
            processingTimeoutPauseDuringToolExec: true,
            toolTimeoutMs,
          },
        } as any,
        { store, templateRegistry, toolRegistry: resolvedToolRegistry, sandboxFactory }
      );

      let lastLlmMonitorError: string | null = null;
      const monitorUnsubs: Array<() => void> = [];
      const attachAgentMonitor = (agent: any) => {
        if (typeof agent?.on !== "function") return;
        const u = agent.on("error", (evt: any) => {
          const sev = String(evt?.severity || "").toLowerCase();
          if (sev !== "error" && sev !== "critical") return;
          const ph = String(evt?.phase || "").trim();
          if (ph !== "model" && ph !== "lifecycle") return;
          const msg = String(evt?.message || "").trim();
          if (msg) lastLlmMonitorError = msg;
        });
        if (typeof u === "function") monitorUnsubs.push(u);
      };
      attachAgentMonitor(agent2);
      const disposeMonitorSubs = () => {
        for (const u of monitorUnsubs) {
          try {
            u();
          } catch {
            /* ignore */
          }
        }
        monitorUnsubs.length = 0;
      };

      const collector = new ToolEventCollector();
      let text = "";
      const startedAt = Date.now();

      let offPermission = callbacks.attachPermissionHandler?.(agent2, collector) ?? null;

      async function handleStreamEvent(envp: any): Promise<"continue" | "break"> {
        if (Date.now() - startedAt > timeoutMs) {
          try {
            await (agent2 as any)?.interrupt?.({ note: `timeout_ms_exceeded:${timeoutMs}` });
          } catch {}
          throw new Error(`timeout_ms_exceeded:${timeoutMs}`);
        }
        if (envp.event.type === "text_chunk") text += envp.event.delta;
        if (envp.event.type === "tool:start" || envp.event.type === "tool:end" || envp.event.type === "tool:error") {
          collector.push(envp.event);
          if (envp.event.type === "tool:start") {
            const cid = normalizeCallId(envp.event);
            if (cid) collector.toolStartAtByCallId.set(cid, Date.now());
            const toolName = normalizeToolName(envp.event);
            if (cid && toolName && runIdStr && callbacks.resolveToolSchema) {
              callbacks
                .resolveToolSchema(toolName, runIdStr)
                .then((r) => {
                  if (!r || !cid) return;
                  collector.toolSchemaRefByCallId.set(cid, {
                    version: r.version ?? null,
                    schema_sha256: r.schema_sha256 ?? null,
                  });
                })
                .catch(() => {});
            }
            callbacks.onToolStart?.(toolName, cid || null);
          }
          if (envp.event.type === "tool:end") {
            collector.recordEndLike(envp.event, "end");
            const toolName = normalizeToolName(envp.event);
            callbacks.onToolEnd?.(toolName || null);
            callbacks.onTaskSnapshot?.();
            if (!isOrchestratorManager(tpl, input) && workerContractEarlyExitEligible(input, collector.events)) {
              try {
                await (agent2 as any)?.interrupt?.({ note: "contract_notify_complete" });
              } catch {}
              return "break";
            }
            if (isOrchestratorManager(tpl, input) && managerKickoffEarlyExitEligible(tpl, input, collector.events)) {
              try {
                await (agent2 as any)?.interrupt?.({ note: "manager_kickoff_worker_dispatched" });
              } catch {}
              return "break";
            }
          }
          if (envp.event.type === "tool:error") {
            collector.recordEndLike(envp.event, "error");
            callbacks.onToolError?.(normalizeToolName(envp.event) || null);
          }
        }
        if (countToolEndEvents(collector.events) >= maxToolCalls) {
          try {
            await (agent2 as any)?.interrupt?.({ note: `max_tool_calls_exceeded:${maxToolCalls}` });
          } catch {}
          throw new Error(`max_tool_calls_exceeded:${maxToolCalls}`);
        }
        if (envp.event.type === "done") return "break";
        return "continue";
      }

      async function runPrimaryUserStream() {
        const remainingMs = () => Math.max(1, timeoutMs - (Date.now() - startedAt));
        let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
        const watchdog = new Promise<never>((_, reject) => {
          watchdogTimer = setTimeout(() => {
            reject(new Error(`timeout_ms_exceeded:${timeoutMs}`));
            void (async () => {
              try {
                await (agent2 as any)?.interrupt?.({ note: `timeout_ms_exceeded:${timeoutMs}` });
              } catch {}
            })();
          }, remainingMs());
        });

        const consume = async () => {
          for await (const envp of agent2.stream([{ type: "text", text: userContent }] as any)) {
            if ((await handleStreamEvent(envp)) === "break") break;
          }
        };

        try {
          await Promise.race([consume(), watchdog]);
        } finally {
          if (watchdogTimer) clearTimeout(watchdogTimer);
        }
      }

      try {
        await runPrimaryUserStream();

        let llmFallbackAttempts = 0;
        while (
          llmFallbackAttempts < 2 &&
          countToolEndEvents(collector.events) === 0 &&
          lastLlmMonitorError &&
          isLlmRetryableProviderError(lastLlmMonitorError)
        ) {
          llmFallbackAttempts += 1;
          const fallbackCfg = findLlmPoolFallback(userConfigs, llmCfgMerged);
          if (!fallbackCfg) break;
          try {
            if (typeof offPermission === "function") offPermission();
          } catch {}
          disposeMonitorSubs();
          try {
            await (agent2 as any)?.dispose?.();
          } catch {}
          Object.assign(llmCfgMerged, fallbackCfg);
          normalizeManagerToolChoiceForLlmCfg(llmCfgMerged, tpl, input);
          for (const k of Object.keys(llmByPurpose)) {
            llmByPurpose[k] = { ...llmByPurpose[k], ...llmCfgMerged };
          }
          const fbModel = resolveAgentLoopProviderFromLlmConfig(llmCfgMerged);
          if (!fbModel) break;
          lastLlmMonitorError = null;
          text = "";
          collector.events.length = 0;
          collector.audit.length = 0;
          collector.toolStartAtByCallId.clear();
          collector.approvalDecisionByCallId.clear();
          collector.toolSchemaRefByCallId.clear();
          agent2 = await runAgentSession(
            {
              templateId: tpl,
              model: fbModel,
              ...(agentId ? { agentId } : {}),
              metadata: {
                processingTimeoutMs: resolveProcessingTimeoutMs(input),
                processingTimeoutPauseDuringToolExec: true,
                toolTimeoutMs,
              },
            } as any,
            { store, templateRegistry, toolRegistry: resolvedToolRegistry, sandboxFactory }
          );
          attachAgentMonitor(agent2);
          offPermission = callbacks.attachPermissionHandler?.(agent2, collector) ?? null;
          await runPrimaryUserStream();
        }

        try {
          if (typeof offPermission === "function") offPermission();
        } catch {}

        if (workerPrimaryToolFollowup(tpl, input) && countToolEndEvents(collector.events) === 0) {
          for await (const envp of agent2.stream([{ type: "text", text: workerPrimaryZeroToolFollowupMessage(input) }] as any)) {
            if (envp.event.type === "text_chunk") text += envp.event.delta;
            if (envp.event.type === "tool:start" || envp.event.type === "tool:end" || envp.event.type === "tool:error") {
              collector.push(envp.event);
              if (envp.event.type === "tool:start") {
                const cid = normalizeCallId(envp.event);
                if (cid) collector.toolStartAtByCallId.set(cid, Date.now());
              }
              if (envp.event.type === "tool:end") collector.recordEndLike(envp.event, "end");
              if (envp.event.type === "tool:error") collector.recordEndLike(envp.event, "error");
            }
            if (envp.event.type === "done") break;
          }
        }

        let managerToolFollowupUsed = false;
        const managerToolEnds = () => countToolEndEvents(collector.events);
        const managerToolFloorActive = managerRequiresToolFloor(tpl, input);
        const managerMinEnds = managerMinToolEnds(input);
        if (managerToolFloorActive && managerToolEnds() < managerMinEnds) {
          managerToolFollowupUsed = true;
          for await (const envp of agent2.stream([
            { type: "text", text: callbacks.managerToolFollowupMessage(input) },
          ] as any)) {
            if (envp.event.type === "text_chunk") text += envp.event.delta;
            if (envp.event.type === "tool:start" || envp.event.type === "tool:end" || envp.event.type === "tool:error") {
              collector.push(envp.event);
              if (envp.event.type === "tool:start") {
                const cid = normalizeCallId(envp.event);
                if (cid) collector.toolStartAtByCallId.set(cid, Date.now());
              }
              if (envp.event.type === "tool:end") collector.recordEndLike(envp.event, "end");
              if (envp.event.type === "tool:error") collector.recordEndLike(envp.event, "error");
            }
            if (envp.event.type === "done") break;
          }
        }
        if (managerToolFloorActive && managerToolEnds() < managerMinEnds) {
          for await (const envp of agent2.stream([
            {
              type: "text",
              text:
                "[系统强制·第三轮] 仍未出现 tool:end。请立即执行一次 JSON 工具调用（不要解释）。" +
                "建议：artifact.write 或 agent.notify（派发 Worker）或 run.set_status。",
            },
          ] as any)) {
            if (envp.event.type === "text_chunk") text += envp.event.delta;
            if (envp.event.type === "tool:start" || envp.event.type === "tool:end" || envp.event.type === "tool:error") {
              collector.push(envp.event);
              if (envp.event.type === "tool:end") collector.recordEndLike(envp.event, "end");
              if (envp.event.type === "tool:error") collector.recordEndLike(envp.event, "error");
            }
            if (envp.event.type === "done") break;
          }
        }

        let managerDispatchFollowupUsed = false;
        if (isOrchestratorManager(tpl, input) && callbacks.managerDispatchFollowupMessage) {
          let dispatchGap = managerDispatchGap(tpl, input, collector.events);
          if (dispatchGap) {
            managerDispatchFollowupUsed = true;
            for await (const envp of agent2.stream([
              { type: "text", text: callbacks.managerDispatchFollowupMessage(input, dispatchGap) },
            ] as any)) {
              if (envp.event.type === "text_chunk") text += envp.event.delta;
              if (envp.event.type === "tool:start" || envp.event.type === "tool:end" || envp.event.type === "tool:error") {
                collector.push(envp.event);
                if (envp.event.type === "tool:start") {
                  const cid = normalizeCallId(envp.event);
                  if (cid) collector.toolStartAtByCallId.set(cid, Date.now());
                }
                if (envp.event.type === "tool:end") collector.recordEndLike(envp.event, "end");
                if (envp.event.type === "tool:error") collector.recordEndLike(envp.event, "error");
              }
              if (envp.event.type === "done") break;
            }
            dispatchGap = managerDispatchGap(tpl, input, collector.events);
          }
        }

        let nonManagerToolFollowupUsed = false;
        if (workerSecondaryToolEnforcement(tpl, input) && countToolEndEvents(collector.events) === 0) {
          nonManagerToolFollowupUsed = true;
          for await (const envp of agent2.stream([
            { type: "text", text: workerSecondaryZeroToolFollowupMessage(input) },
          ] as any)) {
            if (envp.event.type === "text_chunk") text += envp.event.delta;
            if (envp.event.type === "tool:start" || envp.event.type === "tool:end" || envp.event.type === "tool:error") {
              collector.push(envp.event);
              if (envp.event.type === "tool:end") collector.recordEndLike(envp.event, "end");
              if (envp.event.type === "tool:error") collector.recordEndLike(envp.event, "error");
            }
            if (envp.event.type === "done") break;
          }
        }

        if (workerSecondaryToolEnforcement(tpl, input) && countToolEndEvents(collector.events) === 0) {
          const gap = {
            code: "worker_no_tool_calls",
            message: `${tpl} produced no tool:end after forced follow-up; runtime does not synthesize stage artifacts`,
            diagnostic: {
              assistant_output_chars: text.length,
              tool_progress_events: collector.events.length,
              non_manager_tool_followup_used: nonManagerToolFollowupUsed,
              contract_outputs: contractOutputFilenames(input),
            },
            output: text,
            toolEvents: collector.events.slice(-50),
            toolAudit: collector.audit.slice(-50),
          };
          if (callbacks.reportWorkerGap && (await callbacks.reportWorkerGap(gap))) {
            return {
              completed: false,
              output: text,
              toolEvents: collector.events.slice(-50),
              toolAudit: collector.audit.slice(-50),
              crusbroAgentId: agentId ?? null,
              aborted: true,
            };
          }
        }

        if (callbacks.onPublishSettlement) {
          await callbacks.onPublishSettlement(collector.events);
        }

        // 与 Manager 派发缺口对称：工具已跑但缺契约 notify 时强制再开一轮，禁止直接判死。
        let workerContractNotifyFollowupUsed = false;
        if (
          agentNotifyEmitEnabled(input) &&
          workerContractToolFloor(input) &&
          contractFirstNextNotify(input) &&
          !workerContractNotifyComplete(input, collector.events) &&
          countToolEndEvents(collector.events) > 0
        ) {
          workerContractNotifyFollowupUsed = true;
          for await (const envp of agent2.stream([
            { type: "text", text: workerContractNotifyFollowupMessage(input) },
          ] as any)) {
            if (envp.event.type === "text_chunk") text += envp.event.delta;
            if (envp.event.type === "tool:start" || envp.event.type === "tool:end" || envp.event.type === "tool:error") {
              collector.push(envp.event);
              if (envp.event.type === "tool:start") {
                const cid = normalizeCallId(envp.event);
                if (cid) collector.toolStartAtByCallId.set(cid, Date.now());
              }
              if (envp.event.type === "tool:end") collector.recordEndLike(envp.event, "end");
              if (envp.event.type === "tool:error") collector.recordEndLike(envp.event, "error");
            }
            if (envp.event.type === "done") break;
          }
        }

        const workerContractNotifyOkAfterSettlement =
          !workerContractToolFloor(input) || workerContractNotifyComplete(input, collector.events);
        if (
          agentNotifyEmitEnabled(input) &&
          workerContractToolFloor(input) &&
          contractFirstNextNotify(input) &&
          !workerContractNotifyOkAfterSettlement
        ) {
          const nn = contractFirstNextNotify(input)!;
          const gap = {
            code: "worker_contract_notify_missing",
            message: `Worker 未发出契约回执 agent.notify intent=${nn.intent}；禁止视为任务完成`,
            diagnostic: {
              assistant_output_chars: text.length,
              tool_progress_events: collector.events.length,
              required_notify_intent: nn.intent,
              tool_ends: countToolEndEvents(collector.events),
              worker_contract_notify_followup_used: workerContractNotifyFollowupUsed,
            },
            output: text,
            toolEvents: collector.events.slice(-50),
            toolAudit: collector.audit.slice(-50),
          };
          if (callbacks.reportContractNotifyMissing && (await callbacks.reportContractNotifyMissing(gap))) {
            return {
              completed: false,
              output: text,
              toolEvents: collector.events.slice(-50),
              toolAudit: collector.audit.slice(-50),
              crusbroAgentId: agentId ?? null,
              aborted: true,
            };
          }
        }

        let orchestrationGap: NotifySessionResult["orchestrationGap"];
        const dispatchGapFinal =
          isOrchestratorManager(tpl, input) ? managerDispatchGap(tpl, input, collector.events) : null;
        if (dispatchGapFinal) {
          orchestrationGap = {
            code: "manager_worker_dispatch_missing",
            message: `Manager 未派发下游 Worker（notify_intent=${dispatchGapFinal.notifyIntent}，缺少 ${dispatchGapFinal.missingIntents.join(", ")}）`,
            diagnostic: {
              assistant_output_chars: text.length,
              tool_progress_events: collector.events.length,
              manager_dispatch_followup_used: managerDispatchFollowupUsed,
              notify_intent: dispatchGapFinal.notifyIntent,
              missing_worker_intents: dispatchGapFinal.missingIntents,
              tool_ends: managerToolEnds(),
            },
          };
          logWarn("notify_session.orchestration_gap", {
            notify_id: notifyId,
            gap_code: orchestrationGap.code,
          });
        } else if (managerToolFloorActive && managerToolEnds() < managerMinEnds) {
          if (lastLlmMonitorError) {
            const cls = classifyLlmMonitorFailure(lastLlmMonitorError);
            orchestrationGap = {
              code: cls.code,
              message: cls.message,
              diagnostic: {
                assistant_output_chars: text.length,
                tool_progress_events: collector.events.length,
                manager_tool_followup_used: managerToolFollowupUsed,
                min_tool_ends: managerMinEnds,
                tool_ends: managerToolEnds(),
                llm_last_error: lastLlmMonitorError.slice(0, 1200),
              },
            };
          } else {
            orchestrationGap = {
              code: "manager_no_tool_calls",
              message: `Manager notify 回合 tool:end 不足（${managerToolEnds()}/${managerMinEnds}）；请检查模型工具调用、llm_config 或业务包编排约束。`,
              diagnostic: {
                assistant_output_chars: text.length,
                tool_progress_events: collector.events.length,
                manager_tool_followup_used: managerToolFollowupUsed,
                min_tool_ends: managerMinEnds,
                tool_ends: managerToolEnds(),
                notify_intent: String(input?.notify_intent || input?.intent || ""),
              },
            };
          }
          logWarn("notify_session.orchestration_gap", {
            notify_id: notifyId,
            gap_code: orchestrationGap.code,
          });
        }

        return {
          completed: true,
          output: text,
          toolEvents: collector.events.slice(-50),
          toolAudit: collector.audit.slice(-50),
          crusbroAgentId: agentId ?? null,
          managerToolFollowupUsed,
          workerContractNotifyOk: workerContractNotifyOkAfterSettlement,
          orchestrationGap,
        };
      } finally {
        disposeMonitorSubs();
      }
    }
  );
}
