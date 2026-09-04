export type SideEffectClass = "read" | "write_workspace" | "outbound";

export type WritePolicy = {
  allowRelativePrefixes?: string[];
  denyAbsolute?: boolean;
};

export type FinalizePredicate = (ctx: {
  workOrderId: string;
  artifactFilenames: string[];
  html?: string;
}) => Promise<boolean> | boolean;

export type ApprovalDecision = "approved" | "rejected" | "pending";

export type HitlRequest = {
  workOrderId: string;
  toolName: string;
  summary: Record<string, unknown>;
};

export type HitlAdapter = {
  request: (req: HitlRequest) => Promise<{ approvalToken: string }>;
  isApproved: (token: string) => Promise<boolean>;
};

export type ArtifactStoreAdapter = {
  write: (workOrderId: string, filename: string, bytes: Buffer) => Promise<void>;
  read?: (workOrderId: string, filename: string) => Promise<Buffer>;
};

export type NotifyQueueAdapter = {
  enqueue: (row: Record<string, unknown>) => Promise<{ id: string }>;
};

export type LockAdapter = {
  acquire: (key: string, owner: string, ttlMs: number) => Promise<boolean>;
  release: (key: string, owner: string) => Promise<void>;
};

export type LogAdapter = {
  append: (event: Record<string, unknown>) => Promise<void>;
};

import type { SessionEventHandler } from "./replay/session-event.js";

export type AgentOsAdapters = {
  clock?: { now: () => Date };
  artifacts?: ArtifactStoreAdapter;
  notifyQueue?: NotifyQueueAdapter;
  approvals?: HitlAdapter;
  locks?: LockAdapter;
  logs?: LogAdapter;
  /** 宿主持久化 replay / 审计事件；OS 不落库。 */
  onSessionEvent?: SessionEventHandler;
};
