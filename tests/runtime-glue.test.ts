import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveRuntimeAgentId,
  stableAgentIdKey,
  buildInjectionMessage,
  injectionIdempotencyKey,
  managerKickoffEarlyExitEligible,
  managerDispatchGap,
  workerContractNotifyComplete,
  contractFirstNextNotify,
  agentNotifyEmitEnabled,
  SkillLoader,
} from "../src/index";

test("resolveRuntimeAgentId scopes by run vs opc_agent", () => {
  const runScoped = resolveRuntimeAgentId("worker_a", {
    tenant_id: "t1",
    opc_id: "o1",
    run_id: "r1",
    config_snapshot: { llm_memory_scope: "run" },
  });
  const opcScoped = resolveRuntimeAgentId("worker_a", {
    tenant_id: "t1",
    opc_id: "o1",
    run_id: "r2",
    config_snapshot: { llm_memory_scope: "opc_agent" },
  });
  assert.ok(runScoped?.startsWith("opc_"));
  assert.equal(opcScoped, opcScoped);
  assert.notEqual(runScoped, opcScoped);
});

test("stableAgentIdKey is deterministic", () => {
  assert.equal(stableAgentIdKey(["a", "b"]), stableAgentIdKey(["a", "b"]));
});

test("injection queue builds message and idempotency key", () => {
  const msg = buildInjectionMessage({
    notifyId: "n1",
    agentKey: "worker",
    status: "completed",
    resultText: "ok",
  });
  assert.match(msg, /子任务回注/);
  const key = injectionIdempotencyKey("run1", "n1");
  assert.match(key, /^inj:run1:/);
});

test("orchestration helpers detect worker notify complete", () => {
  const input = {
    config_snapshot: {
      contract: {
        next_notifies: [{ to_agent: "manager", intent: "task.done" }],
      },
    },
  };
  const nn = contractFirstNextNotify(input);
  assert.equal(nn?.intent, "task.done");
  const done = workerContractNotifyComplete(input, [
    { type: "tool:end", name: "agent.notify", input_preview: '{"intent":"task.done"}' },
  ]);
  assert.equal(done, true);
});

test("workerContractNotifyFollowupMessage references contract intent only", async () => {
  const { workerContractNotifyFollowupMessage } = await import("../src/runtime/orchestration-helpers.js");
  const msg = workerContractNotifyFollowupMessage({
    config_snapshot: {
      contract: {
        outputs: [{ filename: "out.json" }],
        next_notifies: [{ to_agent: "manager", intent: "stage.done" }],
        failure_notify: { to_agent: "manager", intent: "stage.failed" },
      },
    },
  });
  assert.match(msg, /stage\.done/);
  assert.match(msg, /stage\.failed/);
  assert.match(msg, /契约回执缺口/);
  assert.doesNotMatch(msg, /hot\.article/);
});

test("manager kickoff early exit after worker dispatch", () => {
  const input = { entry: "run.entry", config_snapshot: { agent_type: "manager" } };
  const events = [
    {
      type: "tool:end",
      name: "agent.notify",
      input_preview: '{"to_agent":"worker_collector","intent":"collect.start"}',
    },
  ];
  assert.equal(managerKickoffEarlyExitEligible("manager", input, events), true);
});

test("managerDispatchGap uses bundle orchestration map", () => {
  const input = {
    entry: "run.entry",
    config_snapshot: {
      agent_type: "manager",
      orchestration: { manager_required_worker_dispatch: { "run.entry": ["hot.rank"] } },
    },
  };
  const gap = managerDispatchGap("manager", input, [{ name: "run.append_note", type: "tool:end" }]);
  assert.ok(gap);
  assert.deepEqual(gap?.missingIntents, ["hot.rank"]);
});

test("SkillLoader exports and indexes empty workspace gracefully", async () => {
  const loader = new SkillLoader();
  await loader.loadIndex({ workspaceRoot: "/nonexistent/path/xyz", skillRoots: ["skills"] });
  assert.equal(loader.getAll().length, 0);
});

test("agentNotifyEmitEnabled respects catalog notify_emit flag", () => {
  assert.equal(agentNotifyEmitEnabled({ config_snapshot: {} }), true);
  assert.equal(
    agentNotifyEmitEnabled({ config_snapshot: { notify_emit: { enabled: false } } }),
    false
  );
  assert.equal(
    workerContractNotifyComplete(
      { config_snapshot: { notify_emit: { enabled: false }, contract: { next_notifies: [{ intent: "task.done" }] } } },
      []
    ),
    true
  );
});
