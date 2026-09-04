import type { AgentTemplateRegistry, ModelProvider, SandboxFactory, Store } from "../engine";

/**
 * Host adapter contract for extracting execute-notify from media HTTP into OS.
 * Media backend implements platform I/O; OS owns agent loop + orchestration gates.
 */
export type NotifySessionInput = {
  notifyId: string;
  templateId: string;
  input: Record<string, unknown>;
  executionId: string;
};

export type NotifySessionHostAdapters = {
  store: Store;
  toolRegistry: unknown;
  buildTemplateRegistry: (templateId: string, input: Record<string, unknown>) => Promise<AgentTemplateRegistry>;
  resolveModel: (input: Record<string, unknown>, purpose: string, userConfigs: Record<string, unknown>) => Promise<ModelProvider>;
  sandboxFactory: (input: Record<string, unknown>, notifyId: string) => Promise<SandboxFactory>;
  loadUserConfigs?: (runId: string) => Promise<Record<string, unknown>>;
  managerToolFollowupMessage?: (input: Record<string, unknown>) => string;
  onPermissionRequired?: (event: unknown, ctx: NotifySessionInput) => Promise<void>;
  onProgress?: (patch: Record<string, unknown>) => void;
  reportExecution?: (payload: Record<string, unknown>) => Promise<void>;
  injectManagerResult?: (payload: Record<string, unknown>) => Promise<void>;
};

export type NotifySessionResult = {
  completed: boolean;
  output: string;
  toolEvents: unknown[];
  toolAudit: unknown[];
  orchestrationGap?: { code: string; message: string; diagnostic?: Record<string, unknown> };
  crusbroAgentId?: string | null;
};

/** Phase-3 entry: will wrap runAgentSession + stream + orchestration gates. */
export type RunNotifySessionFn = (
  session: NotifySessionInput,
  adapters: NotifySessionHostAdapters
) => Promise<NotifySessionResult>;
