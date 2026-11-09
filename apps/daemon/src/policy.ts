import type { PermissionRequirement } from './tools/registry.js';

export const TOOL_CLASSES = ["read", "search", "browse", "act-local", "act-external", "secrets"] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];
export type Mode = "auto" | "ask" | "deny";

export interface TurnRestrictions {
  readonly unattended?: boolean;
  readonly allowApprovals?: boolean;
  readonly isolated?: boolean;
  readonly noNetwork?: boolean;
}

/** Passive eligibility only. Execution still passes through decide/approvals and receipt guards. */
export function turnToolRestriction(cls: ToolClass, mode: Mode, turn: TurnRestrictions, offlineSafe?:boolean): "isolated" | "offline" | "unattended" | null {
  if (turn.isolated) return "isolated";
  if (turn.noNetwork && (cls === "search" || cls === "browse" || offlineSafe===false)) return "offline";
  if (turn.unattended && !turn.allowApprovals && (!(cls === "read" || cls === "search" || cls === "browse") || mode !== "auto")) return "unattended";
  return null;
}

export const MODES: readonly Mode[] = ["auto", "ask", "deny"];
export const isToolClass = (x: unknown): x is ToolClass =>
  typeof x === "string" && (TOOL_CLASSES as readonly string[]).includes(x);
export const isMode = (x: unknown): x is Mode => typeof x === "string" && (MODES as readonly string[]).includes(x);

// Static map of known tools. Anything not listed is treated as the strictest external class.
const TOOL_NAME_CLASSES: Record<string, ToolClass> = {
  // Daemon bookkeeping only; unattended input requests are refused by the runner.
  agent_list: "read",
  agent_request_cancel: "act-local",
  agent_consult: "act-local",
  request_input: "read",
  investigation_read: "read",
  create_work: "act-local",
  avatar_preview: "read",
  avatar_library_add: "act-local",
  drive_search: "search",
  drive_read: "read",
  gmail_search: "search",
  gmail_read: "read",
  read_file: "read",
  list_files: "read",
  search_files: "search",
  web_search: "search",
  brave_search: "search",
  browse: "browse",
  screenshot: "browse",
  // Sandbox computer (tools/computer.ts). Shell is act-external: the sandbox has network access.
  computer_screenshot: "browse",
  computer_click: "act-local",
  computer_type: "act-local",
  computer_key: "act-local",
  computer_scroll: "act-local",
  computer_open: "act-local",
  computer_shell: "act-external",
  // Sends a short text to the user's phone (push). Always asks, like every external action.
  notify_user: "act-external",
  write_file: "act-local",
  // Agent-facing MEMORY write (tools/memory.ts): asks by default, like every act-local tool.
  memory_append: "act-local",
  openag_capabilities: "read",
  openag_help: "read",
  openag_status: "read",
  skill_load: "read",
  skill_list: "read",
  skill_save: "act-local",
  save_result: "act-local",
  // Nightly reflection proposals (reflection-schema.ts). Classified so the approval carries an honest class.
  reflection_memory: "act-local",
  reflection_skill: "act-local",
  edit_file: "act-local",
  run_shell: "act-external",
  send_message: "act-external",
  post: "act-external",
  pay: "act-external",
  publish: "act-external",
  delete: "act-external",
  read_secret: "secrets",
  // Claude Code tool names (ACP). Bash is act-external on purpose: a shell can reach anywhere.
  Read: "read",
  LS: "read",
  Glob: "search",
  Grep: "search",
  WebSearch: "search",
  WebFetch: "browse",
  Write: "act-local",
  Edit: "act-local",
  MultiEdit: "act-local",
  NotebookEdit: "act-local",
  Bash: "act-external",
  // Codex ACP tool names (derived from the ACP tool kind). codex.shell is act-external for the same reason as Bash.
  "codex.shell": "act-external",
  "codex.edit": "act-local",
  "codex.fetch": "browse",
  "codex.search": "search",
  "codex.read": "read",
};

// Admin overrides for MCP tools, set only by the MCP manager from the local mcp.json. Keys are full daemon names
// (`mcp.<server>.<tool>`), which the static map can never contain, so an override cannot shadow a built-in tool.
let adminToolClasses: ReadonlyMap<string, ToolClass> = new Map();

/** Replaces the whole admin override map. Called only by the MCP manager. */
export function setAdminToolClasses(map: Record<string, ToolClass>): void {
  adminToolClasses = new Map(Object.entries(map));
}

// Classes of tools from Apps the OWNER enabled (apps.ts). Keys are `app_<id>_<tool>`, which the static map never
// contains. Only read/search/browse/act-local/act-external are accepted; `secrets` can never be declared.
let appToolClasses: ReadonlyMap<string, ToolClass> = new Map();
const APP_CLASSES: ReadonlySet<ToolClass> = new Set<ToolClass>(["read", "search", "browse", "act-local", "act-external"]);

/** Replaces the whole map. Called only by the Apps manager. */
export function setAppToolClasses(map: Record<string, ToolClass>): void {
  appToolClasses = new Map(Object.entries(map).filter(([name, cls]) => name.startsWith("app_") && APP_CLASSES.has(cls)));
}

// `hints` come from untrusted tool metadata and are accepted for future use only; they must never
// loosen a classification, so unknown tools are always act-external.
export function classify(toolName: string, _hints?: { toolClass?: ToolClass }): ToolClass {
  // Own properties only: "constructor", "toString", "__proto__"... must never resolve through the prototype chain.
  const builtin = Object.hasOwn(TOOL_NAME_CLASSES, toolName) ? TOOL_NAME_CLASSES[toolName] : undefined;
  return builtin ?? adminToolClasses.get(toolName) ?? appToolClasses.get(toolName) ?? "act-external";
}

/** The preset approval policy only decides explicit operation requirements. */
export function sessionToolMode(approval:'ask'|'never',requirement:{approval:'allow'|'review'|'deny';message?:string}):{mode:Mode;reason:string|null} {
  const mode=requirement.approval==='allow'?'auto':requirement.approval==='deny'||approval==='never'?'deny':'ask';
  return {mode,reason:requirement.message??(mode==='deny'&&approval==='never'?'This operation explicitly requires review, but the effective approval policy is Never. It was not approved or executed.':null)};
}

export function sessionRequirement(requirement:PermissionRequirement,cls:ToolClass,turn:TurnRestrictions):PermissionRequirement {
  return turn.unattended&&turn.allowApprovals&&!['read','search','browse'].includes(cls)&&requirement.approval==='allow'
    ?{...requirement,approval:'review',message:'This background operation requires explicit review; an interactive mode does not authorize background writes.'}:requirement;
}

/** Only daemon-owned operation requirements can refine a registered tool's effects. */
export function operationClass(name:string,requirement?:PermissionRequirement):ToolClass {
  const effects=requirement&&Object.hasOwn(requirement,'effects')?requirement.effects:undefined;
  return isToolClass(effects)?effects:classify(name);
}
