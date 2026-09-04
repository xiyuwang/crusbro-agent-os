# @crusbro/agent-os

**Embeddable Agent & Cluster runtime** — LLM + Tools + Skills + Notify, without UI or domain glue.

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-see%20repo-lightgrey)](./LICENSE)

---

## Why agent-os?

Most agent stacks either hard-code a DAG or treat multi-agent coordination as an afterthought. **agent-os** is a thin, embeddable kernel:

| You get | You don't get (by design) |
|---------|---------------------------|
| Single-agent loop (`runAgentSession`) | Admin UI / dashboards |
| Multi-agent Cluster (`runClusterSession`) | Vertical domain (billing, CMS, media) |
| AgentCatalog v2 + ClusterManifest v1 validation | Hard-coded business intents |
| HITL outbound freeze, write policy, evidence | Bundle / template directory loading |
| Notify idempotency & wall-clock timeouts | Fixed pipeline orchestration |

**Orchestration ≠ DAG.** Agents plan and hand off via LLM + tools + `agent.notify`. The OS enforces contracts, gates, HITL, and timeouts — **your host owns the domain**.

This package is the **runtime only**. Downstream tools and hosts depend on `@crusbro/agent-os`; this repo does not depend on them.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                     Host application                     │
│   (registerHostTool / bindExecuteNotify / HITL / DB)     │
└──────────────────────────┬──────────────────────────────┘
                           │ createAgentOs()
┌──────────────────────────▼──────────────────────────────┐
│                   @crusbro/agent-os                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │  Agent   │  │  Cluster  │  │ Harness (HITL/write) │  │
│  │ session  │  │  notify   │  │ Catalog validation   │  │
│  └────┬─────┘  └─────┬─────┘  └──────────────────────┘  │
│       └───────┬──────┘                                   │
│               ▼                                          │
│         Engine (LLM · Tools · Skills · Sandbox)          │
└──────────────────────────────────────────────────────────┘
```

| Layer | Path | Role |
|-------|------|------|
| Agent | `src/agent/` | Single-agent session entry |
| Cluster | `src/cluster/` | Routing, invariants, idempotency, `runClusterSession` |
| Engine | `src/engine/` | Pool, Skills, providers, sandbox, builtin tools |
| Framework | `src/framework/` | Contract / tools_gate / workspace helpers |
| Runtime | `src/runtime/` | `runNotifySession`, LLM pool, orchestration hooks |
| Harness | `src/harness/` | Outbound freeze, write policy, evidence / session events |
| Catalog | `src/catalog/` | AgentCatalog schema + validation |

---

## Quick start

**Requirements:** Node.js ≥ 18

```bash
npm install
npm test
npm run build   # → dist/
```

### Minimal host

```ts
import { createAgentOs } from "@crusbro/agent-os";

const os = createAgentOs({
  catalog: myCatalogV2,          // AgentCatalog v2 JSON
  hostTools: [                   // your domain tools
    { name: "fetch_page", instance: myFetchTool, sideEffect: "read" },
  ],
  onSessionEvent: (ev) => console.log(ev.kind, ev),
});

os.registerHostTool({ name: "publish", instance: myPublishTool, sideEffect: "outbound" });
os.bindExecuteNotify(yourHttpHandler);   // wire worker → execute-notify

await os.runAgentSession({ /* … */ });
// or multi-agent:
await os.runClusterSession({ /* … */ });
```

### Consume from a host

Hosts and tooling depend on this package (not the reverse):

```text
your-workspace/
├── crusbro-agent-os/     ← this package (build → dist/)
└── your-host-app/        ← depends on @crusbro/agent-os
```

Typical local link: `"@crusbro/agent-os": "file:../crusbro-agent-os"`. After kernel changes, run **`npm run build`** — consumers and release packs use `dist/`.

---

## Modules

| Import | Responsibility |
|--------|----------------|
| `@crusbro/agent-os` | Facade: `createAgentOs`, catalog/cluster validate, harness |
| `@crusbro/agent-os/agent` | Single agent: `runAgentSession` |
| `@crusbro/agent-os/cluster` | Multi-agent: `runClusterSession`, manifest validation |
| `@crusbro/agent-os/engine` | Low-level engine (Pool, Skills, providers, sandbox) |

### Design invariants

1. **Orchestration ≠ DAG** — LLM + tools + notify; OS guarantees gates & finalize hooks  
2. **Agent ≠ Cluster** — independent components; Cluster mounts Agent via `catalog_ref`  
3. **Outbound freeze** — no approval token → `assertOutboundAllowed` throws  
4. **Notify idempotency** — full `n1|{runId}|{from}|{to}|{intent}|{bare}`, never `run_id` alone  
5. **No zero-tool / no-contract completion** — Manager/Worker tool floor + contract notify  
6. **Wall-clock timeout** — sessions must be interruptible by wall clock  
7. **No default domain tree** — bundle directory loading belongs to the host  

---

## Who depends on this?

| Consumer | How it uses agent-os |
|----------|----------------------|
| **Your host app** | Embeds the kernel: tools, HITL, persistence, tenancy |
| Optional builders / codegen tools | Validate catalogs & ship projects that vendor or link this package |

Flow: **host (or builder) depends on agent-os** → **agent-os runs sessions** → **host tools execute domain work**.

---

## Status

- Package: `@crusbro/agent-os` · version `0.1.0` (early; Catalog v2 / ClusterManifest v1 stabilizing)  
- **Contributing:** shared kernel behavior belongs here; domain logic belongs in the host that depends on this package
