import type { RuntimeOutcome } from './hosted-execution.js';
import type { ExecutionEvidence,ExecutionOutcome } from "../action-receipts.js";
import type { PromptAttachment } from "../uploads.js";
import type { Ledger, LedgerEvent } from "../ledger.js";
import type { WorkReport } from "../work.js";
import type { HostedInput } from "../prompt.js";
import type { Bot, Room } from "../rooms.js";

export type ToolOutcome = (
  | { ok: true; result: unknown; approvalId?:string; executionOutcome?:ExecutionOutcome }
  | { ok: false; status: "denied" | "ignored" | "responded" | "error" | "unknown"; message: string; result?: unknown }) & {effectVerification?:"not-checked";reason?:"receipt_conflict";blockingReceiptId?:string;nextStep?:"wait"|"owner_inspection";invocationOutcome?:"returned";approvalId?:string;receiptId?:string;executionOutcome?:ExecutionOutcome;truncated?:true;originalCharacters?:number};

export type AuthorizeResult =
  | { allowed: true; args: unknown; effectScope?: import("../effect-scope.js").EffectScope; approvalId?: string; contractVersion?: string; permissionSession?: import('../permissions.js').PermissionSession; executionPolicy?: import('../execution.js').ExecutionPolicy; permissionRequirement?: import('../tools/registry.js').PermissionRequirement; permissionApproval?:'ask'|'never'; toolClass?:import('../policy.js').ToolClass }
  | { allowed: false; reason?:"receipt_conflict";blockingReceiptId?:string;nextStep?:"wait"|"owner_inspection"; status: "denied" | "ignored" | "responded"; message: string };

/** Bounds on an approval wait. Without them, a wait lasts until the user decides. */
export interface GateOptions {
  toolCallId?: string;
  signal?: AbortSignal;
  maxWaitMs?: number;
  /** When it returns true as a bound fires, the approval is left pending (daemon shutdown: it must survive a restart). */
  keepPending?: () => boolean;
}

export interface InvestigationExecution {
  readonly id:string;
  readonly signal:AbortSignal;
  readonly instructions:string;
  readonly valid:()=>boolean;
}
export interface TurnContext {
  readonly investigation?:InvestigationExecution;
  room: Room;
  bot: Bot;
  /** The message that triggered this turn. */
  message: LedgerEvent;
  /** What to send the agent: the message text, or on a resumed turn a "continue" / follow-up instruction. */
  prompt: string;
  /** Daemon-selected context for API/Ollama; ACP keeps its original text/session path. */
  hostedInput?: HostedInput;
  /** Bounded ledger context for a fresh ACP session; null means selection failed closed. */
  acpHistory?: string | null;
  acpContext?:import('../request-provenance.js').ContextProjection;
  /** A durable question is open; ending this prompt is not owner cancellation. */
  readonly awaitingInput?: boolean;
  /** Deferred until required input and tool schemas have passed text admission. */
  loadHostedRecall?:()=>Promise<Array<{source:string;content:string}>>;
  /** True when this turn is continuing after a daemon restart (see turns.state_json). */
  resumed: boolean;
  turnId: string;
  workId?: string;
  attachments?: PromptAttachment[];
  signal?: AbortSignal;
  reportWork?(report: WorkReport): void;
  ledger: Ledger;
  /** Persisted per-turn state (turns.state_json); survives restarts, used by OA-010 to resume. */
  state: Record<string, unknown>;
  saveState(patch: Record<string, unknown>): void;
  /** Daemon authorization only: effective permission plus trusted operation requirement. Native ACP effects are refused. */
  authorize(toolName: string, args: unknown, opts?: GateOptions): Promise<AuthorizeResult>;
  /** Gate + execute a daemon-owned tool. Runtimes must never run these tools directly. */
  callTool(toolName: string, args: unknown, opts?: GateOptions): Promise<ToolOutcome>;
  /** Number of callTool invocations so far in this turn (for per-turn caps). */
  toolCalls: number;
  startAction?(approvalId: string, toolCallId?: string): void;
  finishAction?(approvalId: string, evidence: ExecutionEvidence): ExecutionOutcome | void;
}

export interface BotRuntime {
  runTurn(ctx: TurnContext): Promise<void | RuntimeOutcome>;
  /** Called when the runner's watchdog gives up on a stalled turn: drop whatever state the stall lives in (best effort). */
  /** May return a small diagnostic object (redacted lines, key NAMES) that the runner records. */
  abortTurn?(ctx: TurnContext): Promise<unknown> | unknown;
  /** Called on daemon shutdown (e.g. to kill child processes). */
  close?(): Promise<void> | void;
}
