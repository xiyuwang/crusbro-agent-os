import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { defineTool } from "../engine";
import type { ToolSpec } from "../catalog/validate";

export function loadJsHandlerModule(absPath: string): (args: Record<string, unknown>) => Promise<unknown> {
  const src = fs.readFileSync(absPath, "utf8");
  const sandbox: { module: { exports: unknown }; exports: unknown; console: Console } = {
    module: { exports: {} },
    exports: {},
    console,
  };
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
  const handler = loadJsHandlerModule(abs);
  return defineTool({
    name: spec.name,
    description: spec.description || `JS host tool ${spec.name}`,
    input_schema: spec.input_schema ?? { type: "object", properties: {} },
    async exec(args: Record<string, unknown>) {
      return handler(args || {});
    },
  });
}
