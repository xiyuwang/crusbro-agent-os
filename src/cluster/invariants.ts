import type { ClusterManifest } from "./validate.js";
import { clusterInvariantFlags, minToolEndsForRole } from "./validate.js";

export function clusterSnapshotFromInput(input: unknown): Record<string, unknown> | null {
  const inp = input as Record<string, unknown> | null | undefined;
  const cs = inp?.cluster_snapshot ?? inp?.orchestration_snapshot;
  if (cs && typeof cs === "object" && !Array.isArray(cs)) {
    return cs as Record<string, unknown>;
  }
  return null;
}

/** 合并 coordinator 段到扁平约束对象，供既有 orchestration 读取路径复用。 */
export function flattenClusterConstraints(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!snapshot) return null;
  const coord = snapshot.coordinator;
  if (coord && typeof coord === "object" && !Array.isArray(coord)) {
    return { ...snapshot, ...(coord as Record<string, unknown>) };
  }
  return snapshot;
}

export function roleMinToolEnds(manifest: ClusterManifest | null, role: string): number {
  if (!manifest) return 0;
  return minToolEndsForRole(manifest, role);
}

export function enforceZeroToolForbidden(manifest: ClusterManifest | null): boolean {
  if (!manifest) return true;
  return clusterInvariantFlags(manifest).zeroToolTurnForbidden;
}

/**
 * @deprecated 契约 notify 由 Agent catalog（notify_emit + contract.next_notifies）驱动，非 Cluster 配置。
 * 保留读取 cluster.invariants.contract_notify_required 仅为兼容旧 manifest，运行时勿依赖此开关。
 */
export function enforceContractNotifyRequired(manifest: ClusterManifest | null): boolean {
  if (!manifest) return true;
  return clusterInvariantFlags(manifest).contractNotifyRequired;
}
