import { permitsOpaqueExecution, type ExecutionPolicy } from '../execution.js';
import type { ExecutionEvidence } from "../action-receipts.js";
import type { EffectScope } from '../effect-scope.js';
import { z } from "zod";
import type { ToolClass, TurnRestrictions } from "../policy.js";
import type { WorkItem } from '../work.js';

export type CapabilityFamily = "search" | "computer" | "notification";
export interface ToolAvailability {
  offered: boolean;
  code: "configured" | "disabled" | "missing_configuration" | "unsupported" | "not_observed" | "running" | "stopped" | "absent" | "unknown" | "busy" | "human_control" | "backend_switch_pending";
  nextStep: string | null;
  observation?: { backend: string; requestedBackend: string | null; state: string; observedAt: number | null };
}

export interface ToolExecContext {
  agentList?: () => unknown;
  cancelAgentRequests?: (requestId?:string) => unknown;
  consultAgent?: (args: import('../agent-requests.js').ConsultationInput) => unknown;
  investigation?:import("../runtimes/types.js").InvestigationExecution;
  signal?:AbortSignal;
  botId: string;
  dataDir: string;
  readonly permission?: Readonly<ExecutionPolicy>;
  readonly permissionApproval?:'ask'|'never';
  readonly assertPermission?: () => void;
  roomId?: string;
  workId?: string;
  turnId?: string;
  toolCallId?: string;
  messageId?: number;
  createWork?: (args:unknown,creationKey:string)=>WorkItem & {alreadyCreated?:boolean};
  review?: Record<string,unknown> | null;
  requestInput?: (prompt:string)=>unknown;
  /** Supplied by the runner, never by tool arguments. */
  readonly turnPolicy?: Readonly<TurnRestrictions>;
}

export interface PermissionRequirement { approval: 'allow' | 'review' | 'deny'; effects?: ToolClass; message?: string; execution?: ExecutionPolicy }

/** Opaque execution cannot acquire filesystem confinement from a tool name or remote hint. */
export function unconfinedPermission(ctx:ToolExecContext,world:string):PermissionRequirement {
  if(ctx.turnPolicy?.unattended)return {approval:'deny',message:`${world} cannot prove an unattended read-only execution boundary. Interactive Full access does not authorize this background process.`};
  return permitsOpaqueExecution(ctx.permission?.mode)?{approval:'allow'}:{approval:'deny',message:`${world} cannot enforce this filesystem boundary. It is unavailable in confined modes; Full access permits unconfined execution.`};
}

export type ToolExecutor = ((ctx: ToolExecContext, args: unknown) => Promise<unknown>) & {
  effectScope?: (ctx: ToolExecContext, args: any) => EffectScope;
  permission?: (ctx: ToolExecContext, args: any) => PermissionRequirement;
  offlineSafe?: boolean;
  editable?: boolean;
  validate?: (args: unknown) => unknown;
  review?: (ctx: ToolExecContext, args: unknown) => Record<string,unknown>;
  confirm?: (result: unknown, args?: unknown) => ExecutionEvidence;
};
export type ToolRegistry = Record<string, ToolExecutor>;

export interface ToolDef<I = any> {
  effectScope?: (ctx: ToolExecContext, args: I) => EffectScope;
  name: string;
  class: ToolClass;
  description: string;
  input: z.ZodType<I>;
  enabled?(): boolean;
  capability?: { family: CapabilityFamily; availability(): ToolAvailability };
  permission?: (ctx: ToolExecContext, args: any) => PermissionRequirement;
  offlineSafe?: boolean;
  editable?: boolean;
  review?: (ctx: ToolExecContext, args: I) => Record<string,unknown>;
  confirm?: (result: unknown, args?: unknown) => ExecutionEvidence;
  execute(ctx: ToolExecContext, args: I): Promise<unknown>;
}

export function enabledTools(defs: ToolDef[]): ToolDef[] {
  return defs.filter(isToolEnabled);
}

export function toolAvailability(def: ToolDef): ToolAvailability {
  if (!def.capability) {
    const offered = def.enabled?.() ?? true;
    return { offered, code: offered ? "configured" : "disabled", nextStep: null };
  }
  try {
    return def.capability.availability();
  } catch {
    return { offered: false, code: "unknown", nextStep: "Ask the administrator to check this tool's configuration." };
  }
}

export const isToolEnabled = (def: ToolDef): boolean => toolAvailability(def).offered;

/** Builds the name -> executor map. Args are validated here; disabled tools throw before running. */
export function toExecutors(defs: ToolDef[]): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const def of defs) {
    const validate = (args: unknown) => {
      const availability = toolAvailability(def);
      if (!availability.offered) throw new Error(`tool ${def.name} is not enabled (${availability.code}). ${availability.nextStep ?? ""}`);
      const parsed = def.input.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        throw new Error(`invalid arguments for ${def.name}: ${issues}`);
      }
      return parsed.data;
    };
    const exec: ToolExecutor = async (ctx,args) => def.execute(ctx,validate(args));
    exec.validate=validate;
    exec.permission=def.permission;
    exec.effectScope=def.effectScope;
    exec.offlineSafe=def.offlineSafe;
    exec.editable=def.editable!==false;
    if(def.review)exec.review=(ctx,args)=>def.review!(ctx,validate(args));
    exec.confirm=def.confirm;
    registry[def.name]=exec;
  }
  return registry;
}

/** The same input-schema projection is used for offering tools and text admission. */
export function toolSchema(def:ToolDef,strict=false):Record<string,unknown>{
  try{const schema=z.toJSONSchema(def.input as z.ZodType,{io:'input'}) as Record<string,unknown>;delete schema.$schema;return schema;}
  catch{if(strict)throw Error('context_invalid: Tool schema cannot be bounded.');return {type:'object',properties:{}};}
}
