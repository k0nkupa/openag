import { createAgentTools } from './agents.js';
import { createAvatarTools } from "./avatars.js";
import type { AvatarLibrary } from "../avatars.js";
import { createCapabilityCatalogue } from "../capabilities.js";
import { createCapabilitiesTool } from "./capabilities.js";
import type { Db } from "../db/index.js";
import { openagHelpTool } from "./knowledge.js";
import { createOpenagStatusTool } from "./status.js";
import type { GoogleConnectors } from "../google-connectors.js";
import { requestInputTool } from "./input.js";
import type { Results } from "../results.js";
import { createResultTool } from "./results.js";
import { createWorkTool } from './work.js';
import type { Computer } from "../computer.js";
import type { Pusher } from "../push.js";
import { createComputerTools } from "./computer.js";
import { createNotifyTool } from "./notify.js";
import { memoryAppendTool } from "./memory.js";
import { createSkillTools } from "./skills.js";
import type { SkillCatalogue } from "../skills.js";
import { defaultToolDefs } from "./index.js";
import { toExecutors, type ToolDef, type ToolRegistry } from "./registry.js";

/**
 * The daemon-owned tools beyond the built-in file tools, wired once so every consumer (the API runtime, the runner's
 * executor lookup and the bot-facing MCP server) sees the same set. A tool the MCP server lists but the runner cannot
 * execute would pass the gate and then fail "unknown tool"; this is the one place that keeps them in step.
 */
export function createFirstPartyTools(deps: { avatars?: AvatarLibrary; db?: Db; skills?: SkillCatalogue; computer: Computer; pusher: Pusher; results?: Results; google?: GoogleConnectors }): {
  /** Tool defs for the API runtime. */
  defs: ToolDef[];
  /** Executors the runner resolves after the gate, for tools not in its static map. */
  executors: ToolRegistry;
  capabilityGuidance(): string;
} {
  const extra = [...createAgentTools(), ...(deps.google?.tools ?? []), openagHelpTool, createOpenagStatusTool(deps.db), requestInputTool,...createComputerTools(deps.computer), createNotifyTool(deps.pusher), memoryAppendTool, ...createSkillTools(deps.db, deps.skills), createResultTool(deps.results)];
  extra.push(createWorkTool(deps.db), ...createAvatarTools(deps.avatars));
  const definitions = [...defaultToolDefs, ...extra];
  const catalogue = createCapabilityCatalogue(deps.db, () => definitions);
  const capabilities = createCapabilitiesTool(catalogue, () => deps.db !== undefined);
  return { defs: [...definitions, capabilities], executors: toExecutors([...extra, capabilities]), capabilityGuidance: catalogue.guidance };
}
