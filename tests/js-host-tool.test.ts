import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspaceApi, loadJsHandlerModule } from "../src/tools/js-host-tool";

test("createWorkspaceApi writes under workspace and blocks path escape", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "os-ws-"));
  const api = createWorkspaceApi(root);
  const abs = api.writeFile("notes/a.txt", "hello");
  assert.equal(fs.readFileSync(abs, "utf8"), "hello");
  assert.ok(abs.includes(path.join("workspace", "notes", "a.txt")));
  assert.throws(() => api.writeFile("../escape.txt", "x"), /path escape/);
  assert.throws(() => api.writeFile("", "x"), /path required/);
});

test("JS host tool can call workspace.writeFile", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "os-js-"));
  const toolFile = path.join(root, "host-tools", "write_note.js");
  fs.mkdirSync(path.dirname(toolFile), { recursive: true });
  fs.writeFileSync(
    toolFile,
    `module.exports = async function handler(args) {
  const file = String((args && args.path) || "notes/demo.txt");
  const content = String((args && args.content) != null ? args.content : "");
  workspace.writeFile(file, content);
  return { ok: true, path: file, chars: content.length };
};
`,
    "utf8"
  );
  const handler = loadJsHandlerModule(toolFile, root);
  const result = (await handler({ path: "notes/hi.txt", content: "hi" })) as {
    ok: boolean;
    path: string;
    chars: number;
  };
  assert.equal(result.ok, true);
  assert.equal(result.path, "notes/hi.txt");
  assert.equal(result.chars, 2);
  assert.equal(fs.readFileSync(path.join(root, "workspace", "notes", "hi.txt"), "utf8"), "hi");
});
