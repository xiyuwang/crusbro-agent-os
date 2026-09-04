import { Agent, globalToolRegistry, type AgentConfig, type AgentDependencies } from "../engine";

/**
 * Kernel runtime entry: start an Agent tool loop.
 * Hosts must call this instead of `Agent.create` so OS owns session construction.
 */
export async function runAgentSession(
  config: AgentConfig,
  deps: Omit<AgentDependencies, "toolRegistry"> & { toolRegistry?: AgentDependencies["toolRegistry"] }
): Promise<Agent> {
  return Agent.create(config, {
    ...deps,
    toolRegistry: deps.toolRegistry ?? globalToolRegistry,
  });
}
