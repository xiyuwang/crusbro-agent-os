# @crusbro/agent-os

**可嵌入的 Agent / Cluster 运行时内核** — LLM + Tools + Skills + Notify，无 UI、无业态业务。宿主注入工具与策略后即可运行。

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-see%20repo-lightgrey)](./LICENSE)

---

## 为什么选 agent-os？

多数框架要么是固定流水线（DAG），要么把多智能体协作当成附属能力。本内核坚持「薄内核、厚宿主」：

| 你得到 | 刻意不做 |
|--------|----------|
| 单 Agent 循环（`runAgentSession`） | Admin 控制台 / 业务 UI |
| 多智能体 Cluster（`runClusterSession`） | 计费、CMS、媒体等垂直业态 |
| AgentCatalog v2 / ClusterManifest v1 校验 | 写死业务 intent |
| HITL 出站冻结、写策略、证据包 | Bundle / 模板目录读取 |
| Notify 幂等与墙钟超时 | 固定 DAG 编排 |

**编排 ≠ DAG。** 靠 LLM + 工具 + `agent.notify` 派发与回执；OS 保证契约、门禁、HITL 与超时——**业态逻辑由宿主负责**。

本仓库**只提供运行时**。下游工具与宿主依赖 `@crusbro/agent-os`；本仓不依赖它们。

---

## 架构

```text
┌─────────────────────────────────────────────────────────┐
│                        宿主应用                          │
│   (registerHostTool / bindExecuteNotify / HITL / DB)     │
└──────────────────────────┬──────────────────────────────┘
                           │ createAgentOs()
┌──────────────────────────▼──────────────────────────────┐
│                   @crusbro/agent-os                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │  Agent   │  │  Cluster  │  │ Harness（HITL/写策略）│  │
│  │  会话    │  │  notify   │  │ Catalog 校验          │  │
│  └────┬─────┘  └─────┬─────┘  └──────────────────────┘  │
│       └───────┬──────┘                                   │
│               ▼                                          │
│         Engine（LLM · Tools · Skills · Sandbox）         │
└──────────────────────────────────────────────────────────┘
```

| 层 | 路径 | 职责 |
|----|------|------|
| Agent | `src/agent/` | 单 Agent 会话入口 |
| Cluster | `src/cluster/` | 路由、不变量、幂等、`runClusterSession` |
| Engine | `src/engine/` | Pool、Skills、providers、sandbox、内置工具 |
| Framework | `src/framework/` | 契约 / tools_gate / workspace 辅助 |
| Runtime | `src/runtime/` | `runNotifySession`、LLM pool、编排钩子 |
| Harness | `src/harness/` | 出站冻结、写策略、证据 / 会话事件 |
| Catalog | `src/catalog/` | AgentCatalog schema 与校验 |

---

## 快速开始

**环境：** Node.js ≥ 18

```bash
npm install
npm test
npm run build   # → dist/
```

### 最小宿主示例

```ts
import { createAgentOs } from "@crusbro/agent-os";

const os = createAgentOs({
  catalog: myCatalogV2,          // AgentCatalog v2 JSON
  hostTools: [                   // 你的业态工具
    { name: "fetch_page", instance: myFetchTool, sideEffect: "read" },
  ],
  onSessionEvent: (ev) => console.log(ev.kind, ev),
});

os.registerHostTool({ name: "publish", instance: myPublishTool, sideEffect: "outbound" });
os.bindExecuteNotify(yourHttpHandler);   // worker → execute-notify

await os.runAgentSession({ /* … */ });
// 多智能体：
await os.runClusterSession({ /* … */ });
```

### 被宿主引用

宿主与工具链依赖本包（方向不可反）：

```text
your-workspace/
├── crusbro-agent-os/     ← 本仓库（先 build → dist/）
└── your-host-app/        ← 依赖 @crusbro/agent-os
```

本地常见写法：`"@crusbro/agent-os": "file:../crusbro-agent-os"`。改完内核后务必 **`npm run build`**（下游与发布包依赖 `dist/`）。

---

## 模块

| 导入 | 职责 |
|------|------|
| `@crusbro/agent-os` | Facade：`createAgentOs`、校验、harness |
| `@crusbro/agent-os/agent` | 单 Agent：`runAgentSession` |
| `@crusbro/agent-os/cluster` | 多智能体：`runClusterSession`、Manifest 校验 |
| `@crusbro/agent-os/engine` | 底层引擎（Pool、Skills、providers、sandbox） |

### 设计不变量

1. **编排 ≠ DAG** — LLM + tools + notify；OS 保证门禁与收口钩子  
2. **Agent ≠ Cluster** — 独立组件；Cluster 通过 `catalog_ref` 挂载 Agent  
3. **出站冻结** — 无审批 token → `assertOutboundAllowed` 抛错  
4. **Notify 幂等** — 完整键 `n1|{runId}|{from}|{to}|{intent}|{bare}`，禁止仅绑 `run_id`  
5. **禁止零工具 / 无契约回执标完成** — Manager/Worker 工具下限 + 契约 notify  
6. **墙钟超时** — 会话须可被墙钟打断，不能只靠 stream  
7. **无默认业态目录** — bundle 目录读取由宿主实现  

---

## 谁依赖本包？

| 消费者 | 如何使用 agent-os |
|--------|-------------------|
| **你的宿主应用** | 嵌入内核：工具、HITL、持久化、租户隔离 |
| 可选的构建 / 代码生成工具 | 校验 Catalog，并生成 vendor 或链接本包的工程 |

链路：**宿主（或构建工具）依赖 agent-os** → **agent-os 跑会话** → **宿主工具执行业态**。

---

## 状态与贡献

- 包名：`@crusbro/agent-os` · 版本 `0.1.0`（早期；Catalog v2 / ClusterManifest v1 趋稳中）  
- **改哪里：** 共享内核行为 → 本仓；业态逻辑 → 依赖本包的宿主
