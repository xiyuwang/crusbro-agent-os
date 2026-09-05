import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Agent,
  createAgentOs,
  executeNotify,
  globalToolRegistry,
  registerExecuteNotifyRoute,
  runAgentSession,
} from "../src/index";

test("OS exports Agent loop and runAgentSession", () => {
  assert.equal(typeof Agent.create, "function");
  assert.equal(typeof runAgentSession, "function");
  assert.equal(typeof globalToolRegistry.register, "function");
});

test("createAgentOs registers host tools on globalToolRegistry", () => {
  const os = createAgentOs({
    hostTools: [
      {
        name: "probe.ping",
        instance: { name: "probe.ping", descriptor: { name: "probe.ping" } },
      },
    ],
  });
  assert.ok(os.registeredToolNames().includes("probe.ping"));
  assert.ok(globalToolRegistry.has("probe.ping"));
});

test("executeNotify requires bound host handler", async () => {
  registerExecuteNotifyRoute(async (req, res) => {
    assert.equal((req.body as { notify_id?: string }).notify_id, "n-1");
    return res.status(200).json({ ok: true });
  });
  const r = await executeNotify({
    notify_id: "n-1",
    template_id: "t1",
    input: {},
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("require e2b works under CJS (chalk overridden to 4.x)", () => {
  assert.ok(require("e2b"));
});
