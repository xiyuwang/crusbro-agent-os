import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { defineTool } from "../engine";
import type { ToolSpec } from "../catalog/validate";

export type WorkspaceApi = {
  /** Write UTF-8 text under `<projectRoot>/workspace/`. Relative paths only; `..` denied. */
  writeFile(relPath: string, content: string): string;
};

export function createWorkspaceApi(projectRoot: string): WorkspaceApi {
  const root = path.resolve(projectRoot, "workspace");
  return {
    writeFile(relPath: string, content: string): string {
      const cleaned = String(relPath || "")
        .replace(/^[/\\]+/, "")
        .trim();
      if (!cleaned) throw new Error("workspace.writeFile: path required");
      if (cleaned.includes("\0")) throw new Error("workspace.writeFile: invalid path");
      const abs = path.resolve(root, cleaned);
      const relToRoot = path.relative(root, abs);
      if (!relToRoot || relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
        throw new Error("workspace.writeFile: path escape denied");
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(content ?? ""), "utf8");
      return abs;
    },
  };
}

export function loadJsHandlerModule(
  absPath: string,
  projectRoot?: string
): (args: Record<string, unknown>) => Promise<unknown> {
  const src = fs.readFileSync(absPath, "utf8");
  const sandbox: {
    module: { exports: unknown };
    exports: unknown;
    console: Console;
    workspace?: WorkspaceApi;
  } = {
    module: { exports: {} },
    exports: {},
    console,
  };
  if (projectRoot) {
    sandbox.workspace = createWorkspaceApi(projectRoot);
  }
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(src, sandbox, { filename: absPath, timeout: 5_000 });
  const exp = sandbox.module.exports as { default?: unknown } | ((args: Record<string, unknown>) => unknown);
  const fn = typeof exp === "function" ? exp : (exp as { default?: unknown }).default;
  if (typeof fn !== "function") {
    throw new Error(`JS host tool ${absPath} must export a function`);
  }
  return async (args) => fn(args);
}

export function createJsCatalogTool(
  spec: Extract<ToolSpec, { kind: "js" }>,
  projectRoot: string
) {
  const abs = path.resolve(projectRoot, spec.source_path);
  const handler = loadJsHandlerModule(abs, projectRoot);
  return defineTool({
    name: spec.name,
    description: spec.description || `JS host tool ${spec.name}`,
    input_schema: spec.input_schema ?? { type: "object", properties: {} },
    async exec(args: Record<string, unknown>) {
      return handler(args || {});
    },
  });
}
