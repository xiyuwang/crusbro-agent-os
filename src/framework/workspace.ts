import fs from "node:fs/promises";
import path from "node:path";

function normalizeRelPath(rel: string): string {
  return rel.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

/** `{workspaceRoot}/{tenantId}/{stationId}/` */
export function stationWorkspaceRoot(workspaceRoot: string, tenantId: string, stationId: string): string {
  return path.resolve(workspaceRoot, tenantId, stationId);
}

export function validateSkillRoots(
  workspaceRoot: string,
  tenantId: string,
  stationId: string,
  skillRoots: unknown
): void {
  if (skillRoots == null) return;
  if (!stationId?.trim()) {
    throw new Error("skill_roots requires a station-bound agent");
  }
  if (!Array.isArray(skillRoots) || skillRoots.length > 20) {
    throw new Error("skill_roots must be an array (max 20)");
  }
  const rootBase = path.resolve(stationWorkspaceRoot(workspaceRoot, tenantId, stationId));
  for (let i = 0; i < skillRoots.length; i++) {
    const rel = skillRoots[i];
    if (typeof rel !== "string" || !rel.trim()) {
      throw new Error(`skill_roots[${i}] invalid`);
    }
    const s = normalizeRelPath(rel);
    if (s.includes("..")) {
      throw new Error(`skill_roots[${i}] must be relative without ..`);
    }
    const resolved = path.resolve(rootBase, s);
    const relToRoot = path.relative(rootBase, resolved);
    if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
      throw new Error(`skill_roots[${i}] escapes workspace`);
    }
  }
}

export function resolveSkillRootPaths(
  workspaceRoot: string,
  tenantId: string,
  stationId: string,
  skillRoots: unknown
): string[] {
  validateSkillRoots(workspaceRoot, tenantId, stationId, skillRoots);
  if (!Array.isArray(skillRoots)) return [];
  const rootBase = path.resolve(stationWorkspaceRoot(workspaceRoot, tenantId, stationId));
  return skillRoots
    .map((rel) => (typeof rel === "string" ? normalizeRelPath(rel) : ""))
    .filter(Boolean)
    .map((rel) => path.resolve(rootBase, rel));
}

export async function ensureStationWorkspace(
  workspaceRoot: string,
  tenantId: string,
  stationId: string
): Promise<string> {
  const root = stationWorkspaceRoot(workspaceRoot, tenantId, stationId);
  await fs.mkdir(root, { recursive: true });
  return root;
}
