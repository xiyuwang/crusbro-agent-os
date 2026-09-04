/**
 * Cluster 层编排辅助：re-export runtime 实现并增加 cluster_snapshot 读取。
 */
export * from "../runtime/orchestration-helpers.js";
export {
  clusterSnapshotFromInput,
  flattenClusterConstraints,
  roleMinToolEnds,
  enforceZeroToolForbidden,
  enforceContractNotifyRequired,
} from "./invariants.js";
