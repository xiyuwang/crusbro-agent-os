import { AsyncLocalStorage } from "node:async_hooks";

export type ExecutionContext = {
  run_id: string;
  notify_id: string;
  execution_id: string;
  tenant_id: string | null;
  opc_id: string | null;
  llm_default_purpose?: string | null;
  llm_by_purpose?: Record<string, Record<string, unknown>> | null;
  config_snapshot?: Record<string, unknown> | null;
};

const als = new AsyncLocalStorage<ExecutionContext>();

export function runWithExecutionContext<T>(ctx: ExecutionContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getExecutionContext(): ExecutionContext | null {
  return als.getStore() || null;
}
