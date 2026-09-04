import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNotifyIdempotencyKey,
  validateClusterManifest,
  isRoutingAllowed,
  minToolEndsForRole,
} from "../src/cluster/index.js";

test("normalizeNotifyIdempotencyKey canonical n1 format", () => {
  const k = normalizeNotifyIdempotencyKey({
    runId: "run-1",
    fromAgent: "Manager",
    toAgent: "worker_a",
    intent: "task.assign",
    rawKey: "dispatch-1",
  });
  assert.equal(k, "n1|run-1|manager|worker_a|task.assign|dispatch-1");
});

test("validateClusterManifest rejects duplicate agent_key", () => {
  const r = validateClusterManifest({
    schema_version: "1.0",
    members: [
      { agent_key: "a", role: "coordinator" },
      { agent_key: "a", role: "worker" },
    ],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors.join("; "), /duplicate agent_key/);
});

test("validateClusterManifest accepts minimal manifest", () => {
  const r = validateClusterManifest({
    schema_version: "1.0",
    members: [
      { agent_key: "lead", role: "coordinator", catalog_ref: "manager" },
      { agent_key: "w1", role: "worker", catalog_ref: "worker" },
    ],
    routing: [{ from: "coordinator", to: "worker", intents: ["task.assign"] }],
    invariants: {
      zero_tool_turn_forbidden: true,
      contract_notify_required: true,
      min_tool_ends: [{ role: "coordinator", min: 1 }],
    },
  });
  assert.equal(r.ok, true);
});

test("isRoutingAllowed enforces routing table", () => {
  const manifest = {
    schema_version: "1.0" as const,
    members: [
      { agent_key: "lead", role: "coordinator" },
      { agent_key: "w", role: "worker" },
    ],
    routing: [{ from: "coordinator", to: "worker", intents: ["task.assign"] }],
  };
  assert.equal(
    isRoutingAllowed(manifest, { fromRole: "coordinator", toRole: "worker", intent: "task.assign" }),
    true
  );
  assert.equal(
    isRoutingAllowed(manifest, { fromRole: "worker", toRole: "coordinator", intent: "task.done" }),
    false
  );
});

test("minToolEndsForRole reads invariants", () => {
  const manifest = {
    schema_version: "1.0" as const,
    members: [{ agent_key: "lead", role: "coordinator" }],
    invariants: { min_tool_ends: [{ role: "coordinator", min: 2 }] },
  };
  assert.equal(minToolEndsForRole(manifest, "coordinator"), 2);
  assert.equal(minToolEndsForRole(manifest, "worker"), 0);
});
