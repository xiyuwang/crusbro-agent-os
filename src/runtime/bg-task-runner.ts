import { AgentTemplateRegistry } from "../engine/core/template.js";
import type { ModelProvider } from "../engine/infra/provider.js";
import { runAgentSession } from "./run-agent-session.js";

export type TaskPriority = "high" | "normal" | "low";

export interface ResourceLimits {
  maxToolCalls?: number;
  maxSteps?: number;
  idleTimeoutMs?: number;
}

export interface ResourceUsage {
  toolCalls: number;
  steps: number;
  totalTokens: number;
}

export interface BgTask {
  id: string;
  templateId: string;
  description: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  priority: TaskPriority;
  prompt: string;
  resultText?: string;
  error?: string;
  cancelReason?: string;
  resourceLimits: ResourceLimits;
  resourceUsage: ResourceUsage;
  lastActivityAt: number;
}

export interface BgTaskRunnerConfig {
  maxConcurrent: number;
  defaultIdleTimeoutMs: number;
  defaultMaxToolCalls: number;
  defaultMaxSteps: number;
}

type BuildTemplateRegistry = (templateId: string, input: any) => Promise<AgentTemplateRegistry>;

interface QueuedTask {
  taskId: string;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

function genId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

export class BgTaskRunner {
  private tasks = new Map<string, BgTask>();
  private pending: QueuedTask[] = [];
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private deps: {
      store: any;
      toolRegistry: any;
      sandboxFactory: any;
      buildTemplateRegistry: BuildTemplateRegistry;
    },
    private cfg: BgTaskRunnerConfig
  ) {}

  getTask(id: string): BgTask | null {
    return this.tasks.get(id) ?? null;
  }

  listTasks(): BgTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  start(opts: {
    templateId: string;
    prompt: string;
    description?: string;
    priority?: TaskPriority;
    limits?: ResourceLimits;
    input?: any;
    model: ModelProvider;
  }): string {
    const id = genId();
    const now = Date.now();
    const task: BgTask = {
      id,
      templateId: String(opts.templateId || "worker_default"),
      description: String(opts.description || "").trim() || `bg_task:${String(opts.templateId || "worker_default")}`,
      status: "queued",
      createdAt: now,
      startedAt: null,
      endedAt: null,
      priority: (opts.priority ?? "normal") as TaskPriority,
      prompt: String(opts.prompt || ""),
      resourceLimits: {
        maxToolCalls: opts.limits?.maxToolCalls ?? this.cfg.defaultMaxToolCalls,
        maxSteps: opts.limits?.maxSteps ?? this.cfg.defaultMaxSteps,
        idleTimeoutMs: opts.limits?.idleTimeoutMs,
      },
      resourceUsage: { toolCalls: 0, steps: 0, totalTokens: 0 },
      lastActivityAt: now,
    };
    (task as any).__input = opts.input ?? {};
    (task as any).__model = opts.model;

    this.tasks.set(id, task);
    this.pending.push({ taskId: id });
    this.sortPending();
    this.drain();
    return id;
  }

  cancel(taskId: string, reason = "cancelled"): boolean {
    const t = this.tasks.get(taskId);
    if (!t) return false;
    if (t.status === "completed" || t.status === "failed" || t.status === "cancelled") return true;
    t.status = "cancelled";
    t.cancelReason = reason;
    t.endedAt = Date.now();
    this.clearIdle(taskId);
    return true;
  }

  private sortPending() {
    this.pending.sort((a, b) => {
      const ta = this.tasks.get(a.taskId);
      const tb = this.tasks.get(b.taskId);
      const pa = PRIORITY_ORDER[(ta?.priority ?? "normal") as TaskPriority] ?? 1;
      const pb = PRIORITY_ORDER[(tb?.priority ?? "normal") as TaskPriority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (ta?.createdAt ?? 0) - (tb?.createdAt ?? 0);
    });
  }

  private runningCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) if (t.status === "running") n++;
    return n;
  }

  private drain() {
    while (this.runningCount() < this.cfg.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift()!;
      const t = this.tasks.get(next.taskId);
      if (!t) continue;
      if (t.status !== "queued") continue;
      t.status = "running";
      t.startedAt = Date.now();
      t.lastActivityAt = Date.now();
      this.runTask(t).finally(() => {
        this.drain();
      });
    }
  }

  private clearIdle(taskId: string) {
    const it = this.idleTimers.get(taskId);
    if (it) clearTimeout(it);
    this.idleTimers.delete(taskId);
  }

  private resetIdle(task: BgTask) {
    task.lastActivityAt = Date.now();
    this.clearIdle(task.id);
    const timeout = task.resourceLimits.idleTimeoutMs ?? this.cfg.defaultIdleTimeoutMs;
    this.idleTimers.set(
      task.id,
      setTimeout(() => {
        const t = this.tasks.get(task.id);
        if (!t) return;
        if (t.status !== "running") return;
        t.status = "failed";
        t.error = "idle_timeout";
        t.endedAt = Date.now();
        this.clearIdle(task.id);
      }, timeout)
    );
  }

  private async runTask(task: BgTask): Promise<void> {
    const model: ModelProvider = (task as any).__model;
    const input: any = (task as any).__input ?? {};
    this.resetIdle(task);
    try {
      const templateRegistry = await this.deps.buildTemplateRegistry(task.templateId, input);
      const agent = await runAgentSession(
        { templateId: task.templateId, model, agentId: task.id } as any,
        { store: this.deps.store, templateRegistry, toolRegistry: this.deps.toolRegistry, sandboxFactory: this.deps.sandboxFactory }
      );

      let text = "";
      for await (const envp of agent.stream([{ type: "text", text: task.prompt }] as any)) {
        this.resetIdle(task);
        const et = envp?.event?.type;
        if (et === "text_chunk") {
          text += String(envp.event.delta || "");
        }
        if (et === "tool:end") {
          task.resourceUsage.toolCalls++;
          task.resourceUsage.steps++;
          if (task.resourceLimits.maxToolCalls && task.resourceUsage.toolCalls >= task.resourceLimits.maxToolCalls) {
            throw new Error("resource_limit:maxToolCalls");
          }
          if (task.resourceLimits.maxSteps && task.resourceUsage.steps >= task.resourceLimits.maxSteps) {
            throw new Error("resource_limit:maxSteps");
          }
        }
        if (et === "done") break;
        if (task.status === "cancelled") throw new Error("cancelled");
      }
      task.status = "completed";
      task.resultText = text;
      task.endedAt = Date.now();
    } catch (e: any) {
      if (task.status !== "cancelled") {
        task.status = "failed";
        task.error = String(e?.message || e || "failed");
        task.endedAt = Date.now();
      }
    } finally {
      this.clearIdle(task.id);
      // prevent leaking large input/model
      delete (task as any).__input;
      delete (task as any).__model;
    }
  }
}

