/**
 * Workspace SKILL.md index + summary + on-demand full load (SkillsManager).
 */
import * as path from "path";
import { access } from "fs/promises";
import { SkillsManager } from "../engine/core/skills/manager.js";
import type { SkillMetadata } from "../engine/core/skills/types.js";

function isInsideParent(parentResolved: string, childResolved: string): boolean {
  const rel = path.relative(parentResolved, childResolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface WorkspaceSkillMeta {
  name: string;
  rootRel: string;
  summary: string;
}

export class SkillLoader {
  private metas: WorkspaceSkillMeta[] = [];
  private fullCache = new Map<string, string>();

  async loadIndex(opts: {
    workspaceRoot: string;
    skillRoots: string[];
    whitelistPackIds?: string[];
  }): Promise<void> {
    this.metas = [];
    this.fullCache.clear();

    const wsRoot = String(opts.workspaceRoot || "").trim();
    if (!wsRoot) return;
    const baseResolved = path.resolve(wsRoot);
    const roots = Array.isArray(opts.skillRoots) ? opts.skillRoots : [];
    const whitelist =
      Array.isArray(opts.whitelistPackIds) && opts.whitelistPackIds.length > 0 ? opts.whitelistPackIds : undefined;

    for (const rel of roots) {
      if (typeof rel !== "string" || !rel.trim()) continue;
      const s = rel.trim().replace(/\\/g, "/");
      if (s.startsWith("/") || s.includes("..")) continue;
      const abs = path.resolve(baseResolved, s);
      if (!isInsideParent(baseResolved, abs)) continue;
      try {
        await access(abs);
        const mgr = new SkillsManager(abs, whitelist);
        const skills: SkillMetadata[] = await mgr.getSkillsMetadata();
        for (const m of skills) {
          const content = await mgr.loadSkillContent(m.name);
          const full = String(content?.content || "").trim();
          const summary = full.replace(/^#.*\n/, "").trim().slice(0, 200);
          this.metas.push({ name: m.name, rootRel: s, summary });
          this.fullCache.set(`${s}::${m.name}`, full);
        }
      } catch {
        continue;
      }
    }
  }

  getSummary(): string {
    if (!this.metas.length) return "(暂无 Skill)";
    return this.metas.map((m) => `- [${m.rootRel}/${m.name}] ${m.summary}`).join("\n");
  }

  async loadFull(rootRel: string, name: string): Promise<string> {
    const k = `${rootRel}::${name}`;
    const v = this.fullCache.get(k);
    if (!v) throw new Error(`Skill not found: ${k}`);
    return v;
  }

  getAll(): WorkspaceSkillMeta[] {
    return [...this.metas];
  }
}
