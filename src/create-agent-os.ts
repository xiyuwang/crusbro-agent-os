import { Agent, builtin, globalToolRegistry, type ToolInstance } from "./engine";
import {
  sideEffectMapFromCatalog,
  toolsGateFromCatalog,
  validateCatalog,
  type AgentCatalog,
  type AgentCatalogV2,
} from "./catalog/validate";
import { createHttpCatalogTool } from "./tools/http-tool";
import { createJsCatalogTool } from "./tools/js-host-tool";
import {
  assertOutboundAllowed,
  effectiveRequireApprovalTools,
} from "./harness/freeze-outbound";
import { assembleEvidenceBundle } from "./harness/evidence-bundle";
import { assertControlledWrite } from "./harness/write-policy";
import type { AgentOsAdapters, SideEffectClass, WritePolicy } from "./harness/types";
import type { ContractPathAlias } from "./framework/contract-interpreter";
import { runAgentSession } from "./agent/session.js";
import { bindExecuteNotify } from "./cluster/execute-notify-bind.js";
import { validateClusterManifest } from "./cluster/validate.js";
import { runClusterSession } from "./cluster/run-cluster-session.js";
import type { SessionEventHandler } from "./harness/replay/session-event.js";

export type HostToolRegistration = {
  name?: string;
  instance: ToolInstance | unknown;
  sideEffect?: SideEffectClass;
};

export type CreateAgentOsOptions = {
  adapters?: AgentOsAdapters;
  catalog?: unknown;
  catalogDir?: string;
  hostTools?: HostToolRegistration[];
  sideEffectClass?: Record<string, SideEffectClass>;
  contractAliases?: ContractPathAlias[];
  writePolicy?: WritePolicy;
  projectRoot?: string;
  onSessionEvent?: SessionEventHandler;
};

export type AgentOs = ReturnType<typeof createAgentOs>;

function asToolInstance(reg: HostToolRegistration): { name: string; instance: unknown } {
  const inst = reg.instance as { name?: string; descriptor?: { name?: string } };
  const name =
    reg.name ||
    String(inst?.name || inst?.descriptor?.name || "").trim();
  if (!name) throw new Error("host tool missing name");
  return { name, instance: reg.instance };
}

export function createAgentOs(opts: CreateAgentOsOptions = {}) {
  const validated = opts.catalog != null ? validateCatalog(opts.catalog) : null;
  if (validated && !validated.ok) {
    throw new Error(`invalid catalog: ${validated.errors.join("; ")}`);
  }
  const catalog: AgentCatalog | AgentCatalogV2 | null = validated && validated.ok ? validated.catalog : null;
  const projectRoot = opts.projectRoot || process.cwd();
  const onSessionEvent = opts.onSessionEvent ?? opts.adapters?.onSessionEvent;

  const sideEffectClass: Record<string, SideEffectClass> = {
    ...(catalog ? sideEffectMapFromCatalog(catalog) : {}),
    ...(opts.sideEffectClass ?? {}),
  };

  const registered: string[] = [];

  function registerHostTool(reg: HostToolRegistration): void {
    const { name, instance } = asToolInstance(reg);
    if (reg.sideEffect) sideEffectClass[name] = reg.sideEffect;
    registered.push(name);
    globalToolRegistry.register(name, () => instance as ToolInstance);
  }

  for (const t of opts.hostTools ?? []) registerHostTool(t);

  if (catalog) {
    for (const spec of catalog.tools) {
      if (spec.kind === "http") registerHostTool({ instance: createHttpCatalogTool(spec), name: spec.name });
      if (spec.kind === "js") {
        registerHostTool({
          instance: createJsCatalogTool(spec, projectRoot),
          name: spec.name,
        });
      }
    }
  }

  const gateRaw = catalog ? toolsGateFromCatalog(catalog) : undefined;

  return {
    catalog,
    adapters: opts.adapters ?? {},
    contractAliases: opts.contractAliases ?? [],
    writePolicy: opts.writePolicy ?? { denyAbsolute: true },
    sideEffectClass,
    builtin,
    engine: { Agent, globalToolRegistry },
    validateCatalog,
    validateClusterManifest,
    registerHostTool,
    onSessionEvent,
    assertOutboundAllowed: (toolName: string, approvalToken?: string | null) =>
      assertOutboundAllowed({
        toolName,
        approvalToken,
        gateRaw,
        sideEffectClass,
      }),
    assertControlledWrite: (filename: string) =>
      assertControlledWrite(filename, opts.writePolicy ?? { denyAbsolute: true }),
    requireApprovalTools: (toolNames: string[]) =>
      effectiveRequireApprovalTools(toolNames, gateRaw, sideEffectClass),
    assembleEvidenceBundle,
    runAgentSession,
    runClusterSession,
    /** @deprecated use runAgentSession */
    runSession: runAgentSession,
    bindExecuteNotify,
    handlers: {
      /** Host binds its own execute-notify HTTP; this is a typed slot. */
      executeNotify: undefined as
        | ((req: { body?: unknown }, res: { status: Function; json: Function }) => Promise<unknown>)
        | undefined,
    },
    registeredToolNames: () => [...registered],
  };
}
