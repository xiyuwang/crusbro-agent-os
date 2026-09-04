import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAgentOs,
  normalizeNotifyIdempotencyKey,
  payloadSatisfiesContractPath,
  validateCatalog,
} from "../src/index";

test("validateCatalog accepts prompt+llm+http tool", () => {
  const r = validateCatalog({
    system_prompt: "You are a helper.",
    llm: { provider: "openai", model: "gpt-4o-mini" },
    tools: [
      {
        kind: "http",
        name: "health",
        method: "GET",
        url: "https://example.com/health",
        side_effect: "read",
      },
    ],
  });
  assert.equal(r.ok, true);
});

test("validateCatalog rejects empty prompt", () => {
  const r = validateCatalog({
    system_prompt: "",
    llm: { provider: "openai", model: "x" },
  });
  assert.equal(r.ok, false);
});

test("createAgentOs freezes outbound without token", () => {
  const os = createAgentOs({
    catalog: {
      system_prompt: "hi",
      llm: { provider: "openai", model: "x" },
      tools: [
        {
          kind: "http",
          name: "push_hook",
          url: "https://example.com/hook",
          side_effect: "outbound",
          require_approval: true,
        },
      ],
    },
  });
  assert.throws(() => os.assertOutboundAllowed("push_hook"));
  os.assertOutboundAllowed("push_hook", "tok_1");
});

test("payloadSatisfiesContractPath has no media aliases in OS", () => {
  assert.equal(
    payloadSatisfiesContractPath({ sources: [{ url: "https://a.test" }] }, "topics"),
    false
  );
});

test("notify idempotency includes from/to/intent", () => {
  const k = normalizeNotifyIdempotencyKey({
    runId: "run-1",
    fromAgent: "manager",
    toAgent: "worker",
    intent: "hot.rank",
    rawKey: "k1",
  });
  assert.equal(k, "n1|run-1|manager|worker|hot.rank|k1");
});
