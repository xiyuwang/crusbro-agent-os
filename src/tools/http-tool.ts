import { defineTool } from "../engine";
import type { ToolSpec } from "../catalog/validate";

function headerRecord(spec: Extract<ToolSpec, { kind: "http" }>): Record<string, string> {
  const headers = { ...(spec.headers ?? {}) };
  if (spec.auth_env) {
    const token = process.env[spec.auth_env];
    if (token) headers.Authorization = headers.Authorization || `Bearer ${token}`;
  }
  return headers;
}

export function createHttpCatalogTool(spec: Extract<ToolSpec, { kind: "http" }>) {
  return defineTool({
    name: spec.name,
    description: spec.description || `HTTP ${spec.method} ${spec.url}`,
    input_schema: spec.input_schema ?? {
      type: "object",
      properties: { body: { type: "object" } },
    },
    async exec(args: Record<string, unknown>) {
      const method = spec.method;
      const headers = { "content-type": "application/json", ...headerRecord(spec) };
      const init: RequestInit = { method, headers };
      if (method !== "GET" && method !== "DELETE") {
        init.body = JSON.stringify(args?.body ?? args ?? {});
      }
      const res = await fetch(spec.url, init);
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep text */
      }
      return { status: res.status, body: parsed };
    },
  });
}
