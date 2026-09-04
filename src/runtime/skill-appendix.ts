import { SkillLoader } from "./skill-loader.js";

export type SkillAppendixInput = {
  workspaceRoot?: string;
  configSnapshot?: Record<string, unknown> | null;
  skillFull?: unknown;
};

function configObj(input: SkillAppendixInput): Record<string, unknown> {
  const cfg = input.configSnapshot;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
}

/** Build system-prompt appendix from workspace SKILL.md roots. */
export async function resolveSkillMarkdownAppendix(input: SkillAppendixInput): Promise<string> {
  const wsRoot = String(input.workspaceRoot || "").trim();
  const cfgObj = configObj(input);
  const rootsRaw = cfgObj.skill_roots;
  if (!wsRoot || !Array.isArray(rootsRaw) || rootsRaw.length === 0) {
    return "";
  }
  const packIds = cfgObj.skill_pack_ids;
  const whitelist =
    Array.isArray(packIds) && packIds.length > 0
      ? packIds.map((x) => String(x).trim()).filter(Boolean)
      : undefined;

  const parts: string[] = [];
  const loader = new SkillLoader();
  await loader.loadIndex({
    workspaceRoot: wsRoot,
    skillRoots: rootsRaw.map((x) => String(x)),
    whitelistPackIds: whitelist,
  });

  parts.push("### Skill Index (summary)\n" + loader.getSummary());

  const injectMode = String(cfgObj.skill_inject_mode || "").trim();
  const fullAll = Boolean(cfgObj.skill_inject_full_all) || injectMode === "full_all";
  const fullSelectedRaw = input.skillFull ?? cfgObj.skill_full ?? cfgObj.skill_inject_full;
  const fullSelected: string[] = Array.isArray(fullSelectedRaw)
    ? fullSelectedRaw.map((x) => String(x).trim()).filter(Boolean)
    : [];

  const wantAll = fullAll && fullSelected.length === 0;
  const wantSelected = fullSelected.length > 0 || injectMode === "full_selected";

  if (wantAll) {
    for (const m of loader.getAll()) {
      try {
        const full = await loader.loadFull(m.rootRel, m.name);
        if (full) parts.push(`\n### Skill Full: ${m.rootRel}/${m.name}\n${full}\n`);
      } catch {
        // ignore missing
      }
    }
  } else if (wantSelected && fullSelected.length > 0) {
    const all = loader.getAll();
    for (const sel of fullSelected) {
      const norm = sel.replace(/\\/g, "/").replace(/^\/+/, "");
      const hit =
        all.find((m) => `${m.rootRel}/${m.name}` === norm) ||
        all.find((m) => m.name === norm) ||
        all.find((m) => `${m.name}`.endsWith(norm));
      if (!hit) continue;
      try {
        const full = await loader.loadFull(hit.rootRel, hit.name);
        if (full) parts.push(`\n### Skill Full: ${hit.rootRel}/${hit.name}\n${full}\n`);
      } catch {
        // ignore missing
      }
    }
  }

  return parts.join("\n\n");
}

/** Notify-input convenience wrapper for hosts that pass opc_workspace_root + config_snapshot. */
export async function resolveSkillMarkdownAppendixFromNotifyInput(
  input: Record<string, unknown> | null | undefined
): Promise<string> {
  if (!input || typeof input !== "object") return "";
  const cfg = (input as any).config_snapshot;
  return resolveSkillMarkdownAppendix({
    workspaceRoot: String((input as any).opc_workspace_root || ""),
    configSnapshot: cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : null,
    skillFull: (input as any).skill_full,
  });
}
