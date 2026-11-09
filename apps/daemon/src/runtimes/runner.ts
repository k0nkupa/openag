import { messageWithReply } from '../message-replies.js';
import { protectScope, type EffectScope } from "../effect-scope.js";
import { forkContext } from '../conversation-forks.js';
import { createAgentRequests, type AgentRequests, type AgentRequestExecution } from '../agent-requests.js';
import { contextDescriptor, type ContextProjection } from '../request-provenance.js';
import { createPermissions,executionPolicy,permissionGuidance,intersectPermissions,scopeAllows,permissionReference,type PermissionReference,type Permissions } from '../permissions.js';
import { requestOutcome, type ProviderWait } from './model-retries.js';
import { hostedLimits, stopHosted, HostedStop, type RuntimeOutcome } from './hosted-execution.js';
import { knowledge } from "../knowledge.js";
import { getDefaultBotId } from "../defaultbot.js";
import { ModelError } from "../botmodels.js";
import { createQuestions, questionAnswerContext } from "../questions.js";
import { nativeFileReview,checkNativeFiles } from "./file-review.js";
import { ActionFailure, canonical, conflictDetails, type ExecutionEvidence } from "../action-receipts.js";
import { createUploads } from "../uploads.js";
import { createWork, type Work } from "../work.js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Approval, Approvals, Decision } from "../approvals.js";
import type { Db } from "../db/index.js";
import type { DispatchArgs } from "../gateway.js";
import type { Ledger, LedgerEvent } from "../ledger.js";
import { getSetting } from "../settings.js";
import { MAX_HOPS, parseDelegations } from "../delegation.js";
import { commitMemory, ensureDataRepo } from "../datagit.js";
import { buildPrompt, buildHostedInput, buildAcpHistory, type HostedInput, mayDelegate } from "../prompt.js";
import { ensureMemoryFile, memoryPath, readMemoryHead } from "../memory.js";
import { createSkillCatalogue, type SkillCatalogue } from "../skills.js";
import { type Bot, getBot, getRoom, type Room, type Runtime } from "../rooms.js";
import { getDefaultRedactor, type Redactor } from "../redact.js";
import { classify, turnToolRestriction, sessionToolMode,sessionRequirement,operationClass } from "../policy.js";
import { createToolGate } from "./gate.js";
import { type Pregrant, pregrantMatches } from "./pregrant.js";
import type { VectorMemory } from "../vectors.js";
import type { ToolRegistry } from "./tools.js";
import type { BotRuntime, GateOptions, TurnContext } from "./types.js";

export interface RunnerDeps {
  permissions?: Permissions;
  skills?: SkillCatalogue;
  db: Db;
  ledger: Ledger;
  approvals: Approvals;
  dataDir: string;
  runtimes: Partial<Record<Runtime, BotRuntime>>;
  tools: ToolRegistry;
  capabilityGuidance?: () => string;
  /** Executors that can change between turns (MCP servers). Looked up after `tools`. */
  dynamicTools?: () => ToolRegistry;
  redactor?: Redactor;
  /** Semantic recall and indexing. Optional: without it, turns run exactly as before. */
  vectors?: VectorMemory;
  /** Stall watchdog limits (ms of ledger silence, outside a pending approval). Defaults: 10 min, 20 min unattended. */
  watchdog?: { idleMs?: number; unattendedIdleMs?: number; tickMs?: number };
}

const MINUTE = 60_000;
/** `OPENAG_TURN_IDLE_MIN` (1-240) overrides the interactive limit. */
function envIdleMs(): number | undefined {
  const n = Number(process.env.OPENAG_TURN_IDLE_MIN);
  return Number.isFinite(n) && n >= 1 && n <= 240 ? Math.floor(n) * MINUTE : undefined;
}

class TurnStalled extends Error {}

/** "slack:<user id>" for a message that came from Slack (see slack.ts); undefined = the desk. */
function sourceOf(message: LedgerEvent): string | undefined {
  const p = message.payload as { source?: unknown; slackUser?: unknown } | null;
  if (p?.source !== "slack") return undefined;
  return typeof p.slackUser === "string" && /^[A-Z0-9]{1,20}$/.test(p.slackUser) ? `slack:${p.slackUser}` : "slack";
}

export interface Runner {
  agentRequests: AgentRequests;
  runInvestigation(room:Room,bot:Bot,message:LedgerEvent,execution:import('./types.js').InvestigationExecution):Promise<void>;
  withIdleBot<T>(id: string, operation: () => Promise<T>): Promise<T>;
  work: Work;
  cancelWork(id: string, revision?: number): void;
  dispatch(args: DispatchArgs): Promise<void>;
  run(room: Room, bot: Bot, message: LedgerEvent, resume?: Resume, meta?: TurnMeta): Promise<void>;
  /** Startup: mark turns left `running` by a previous (crashed) process as `interrupted`. Returns how many. */
  recover(): number;
  /**
   * Graceful stop: mark in-flight turns `interrupted` (not failed) so an approved action can resume them after
   * the restart. Call before closing runtimes, whose teardown would otherwise fail those turns.
   */
  shutdown(): number;
  /** Resolves when all turns resumed by approval decisions have settled (tests, shutdown). */
  idle(): Promise<void>;
  /** Shutdown barrier for all admitted runs and their background work. */
  drain(): Promise<void>;
  /** The turn currently executing for this bot in this room, if any. */
  activeTurn(botId: string, roomId: string): TurnContext | undefined;
}

interface TurnRow {
  id: string;
  room_id: string;
  bot_id: string;
  status: string;
  state_json: string | null;
}

/** Delegation bookkeeping, persisted in turns.state_json. */
export interface TurnMeta {
  agentRequestId?: string;
  sourceWorkId?:string;
  agentRequestResult?: boolean;
  /** Daemon-owned ancestor references, never model or client input. */
  permissionParents?:readonly PermissionReference[];
  investigationId?:string;
  workId?: string;
  /** Trusted internal history boundary; never accepted from model input or HTTP bodies. */
  historyAfterId?: number;
  providerWait?:ProviderWait;
  parentWorkId?: string;
  hop?: number;
  delegatedBy?: string;
  delegationId?: string;
  resultFor?: string;
  /**
   * Scheduled turn (heartbeat): read, search and browse only, and never an approval. Delegations and result turns
   * inherit it. See `turnToolRestriction`.
   */
  unattended?: boolean;
  /** Where the triggering message came from ("slack:<user>"); non-desk turns are never indexed and tag their approvals. */
  source?: string;
  /**
   * With `unattended`: lets the normal gate run, so act-* tools can ask for approval (or run when auto).
   * Without it, every non-read tool is denied regardless of stored modes.
   */
  allowApprovals?: boolean;
  /**
   * Isolated turn (nightly reflection): it reads a digest of other rooms, so it gets NO tools at all (every call is
   * denied, even read/search/browse), cannot delegate, and is not written to the vector recall index. Its only output
   * is text the daemon parses. Never inherited by other turns.
   */
  isolated?: boolean;
  /** Keep this turn out of the vector recall index (turns that carry untrusted external text). */
  noIndex?: boolean;
  /** Deny search and browse tools (any outbound channel). Used with unattended turns that read untrusted text. */
  noNetwork?: boolean;
}


interface Resume {
  turnId: string;
  state: Record<string, unknown>;
  prompt: string;
}

export function createRunner(deps: RunnerDeps): Runner {
  const permissions=deps.permissions??createPermissions(deps.db,deps.ledger,deps.dataDir,deps.approvals);
  const { db, ledger } = deps;
  const skills = deps.skills ?? createSkillCatalogue(db, deps.dataDir);
  const work = createWork(db, ledger);
  const questions = createQuestions(db, ledger);
  const uploads = createUploads(db, deps.dataDir);
  const receipts=deps.approvals.receipts;
  const executor=(name: string) => {const dynamic=deps.dynamicTools?.()??{};return Object.hasOwn(deps.tools,name)?deps.tools[name]:Object.hasOwn(dynamic,name)?dynamic[name]:undefined;};
  deps.approvals.setEditValidator(name=>{
    const exec=executor(name);if(!exec?.validate||exec.editable===false)return undefined;
    return (args,approval)=>{const parsed=exec.validate!(args);if(name==='create_work'&&approval)exec.review?.({botId:approval.botId,roomId:approval.roomId,dataDir:deps.dataDir,turnId:approval.turnId??undefined,messageId:approval.review?.originMessageId as number|undefined},parsed);return parsed;};
  });

  const configuring = new Map<string, Promise<void>>();
  const admissions = new Map<string, number>();
  const chatClaims = new Set<string>();
  const agentExecutions = new Map<number, AgentRequestExecution>();
  const investigations = new Map<number,import('./types.js').InvestigationExecution>();
  const workControllers = new Map<string, { workId: string | undefined; controller: AbortController }>();
  const redactor = deps.redactor ?? getDefaultRedactor();
  const gate = createToolGate({ db, approvals: deps.approvals });
  const setTurn = db.prepare("UPDATE turns SET status = ?, updated_at = ? WHERE id = ?");
  const runs = new Set<Promise<void>>();
  const resumedRuns = new Set<Promise<void>>();
  // Background indexing after a turn. idle() waits for these too.
  const background = new Set<Promise<void>>();
  const vectors = deps.vectors;
  // Hash of the MEMORY.md text last indexed, per bot, so unchanged files are not re-chunked.
  const indexedMemory = new Map<string, string>();
  const scheduleIndex = (bot: Bot, turnId: string, question: string, answer: string) => {
    const job = (async () => {
      try {
        const path = memoryPath(deps.dataDir, bot.id);
        if (existsSync(path)) {
          const text = readFileSync(path, "utf8");
          const hash = createHash("sha256").update(text).digest("hex");
          if (indexedMemory.get(bot.id) !== hash) {
            vectors?.indexMemoryFile(bot.id, text);
            indexedMemory.set(bot.id, hash);
          }
        }
        if (answer) vectors?.indexTurn(bot.id, turnId, question, answer);
        await vectors?.embedPending();
      } catch (err) {
        console.error("vector indexing skipped:", err instanceof Error ? err.message : String(err));
      }
    })();
    background.add(job);
    void job.finally(() => background.delete(job));
  };
  // Memory commits need the data dir to be a git repo; set up once, and if that fails, skip commits.
  let dataRepo: Promise<boolean> | undefined;
  const dataRepoReady = (): Promise<boolean> => {
    dataRepo ??= ensureDataRepo(deps.dataDir).then(
      () => true,
      (err: unknown) => {
        console.error("data repo unavailable; memory commits disabled:", err instanceof Error ? err.message : String(err));
        return false;
      },
    );
    return dataRepo;
  };

  // One turn at a time per (bot, room): an ACP session can't run two prompts at once. The lock covers the
  // turn itself and is released before delegation follow-ups start, so a delegator is free to take the result.
  const locks = new Map<string, Promise<void>>();
  async function acquire(key: string, signal?:AbortSignal): Promise<() => void> {
    const prev = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const tail = prev.then(() => mine);
    locks.set(key, tail);
    if(signal){
      let abort!:()=>void;
      const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(new Error('Turn cancelled while waiting'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
      try{await Promise.race([prev,stopped]);}catch(error){release();void tail.then(()=>{if(locks.get(key)===tail)locks.delete(key);});throw error;}finally{signal.removeEventListener('abort',abort);}
    }else await prev;
    return () => {
      release();
      if (locks.get(key) === tail) locks.delete(key);
    };
  }
  let shuttingDown = false;
  // The turn currently executing per (bot, room). Set and cleared inside the lock, so at most one exists per key.
  const activeTurns = new Map<string, TurnContext>();
  const turnKey = (botId: string, roomId: string) => JSON.stringify([botId, roomId]);

  function markInterrupted(message: string): number {
    const rows = db.prepare("SELECT * FROM turns WHERE status = 'running'").all() as TurnRow[];
    for (const row of rows) {
      setTurn.run("interrupted", Date.now(), row.id);
      ledger.append(row.room_id, row.bot_id, "error", { turnId: row.id, message });
    }
    for(const row of rows)receipts.recover(row.id);
    return rows.length;
  }

  function interruptConsultationWork() {
    for(const r of db.prepare("SELECT DISTINCT r.id FROM work_runs r JOIN agent_requests a ON a.initiator_turn_id=r.turn_id WHERE r.status='draining' AND a.delivery!='delivered'").all() as {id:string}[])work.updateRun(r.id,'interrupted','Consultation stopped before findings were delivered. Nothing was replayed.');
  }

  function deliveryMeta(room:Room,bot:Bot,message:LedgerEvent):TurnMeta|undefined {
    const delivery=questions.delivery(message.id,bot.id,room.id);
    if(delivery)return {...delivery.meta,workId:delivery.question.workId??undefined};
    const assignment=db.prepare("SELECT w.id FROM work w JOIN work_runs r ON r.work_id=w.id WHERE w.creation_key IS NOT NULL AND w.room_id=? AND w.bot_id=? AND r.message_id=? AND r.status='queued' AND r.turn_id IS NULL").get(room.id,bot.id,message.id) as {id:string}|undefined;
    if(assignment)return {workId:assignment.id};
    const recovery=db.prepare("SELECT w.id,a.context_json FROM work w JOIN work_recovery_actions a ON a.continued_work_id=w.id WHERE a.message_id=? AND w.bot_id=? AND w.room_id=?").get(message.id,bot.id,room.id) as {id:string;context_json:string}|undefined;
    return recovery?{...JSON.parse(recovery.context_json),workId:recovery.id}:undefined;
  }

  const botBusy = (id: string) => configuring.has(id) || (admissions.get(id) ?? 0) > 0 ||
    !!db.prepare("SELECT 1 FROM approvals WHERE bot_id=? AND status='pending'").get(id) ||
    !!db.prepare("SELECT 1 FROM action_receipts WHERE bot_id=? AND outcome='pending'").get(id) ||
    !!db.prepare("SELECT 1 FROM work_runs r JOIN work w ON w.id=r.work_id WHERE w.bot_id=? AND r.status IN ('queued','running','draining')").get(id);
  const agentRequests = createAgentRequests({db,ledger,permissions,approvals:deps.approvals,busy:botBusy,
    available:bot=>!!deps.runtimes[bot.runtime],
    attachments:(roomId,messageId)=>{const source=ledger.get(messageId);if(source?.roomId!==roomId)throw Error('Attachment source unavailable');return uploads.forMessage(roomId,messageId,(source.payload as {attachments?:{id:string}[]}).attachments?.map(f=>f.id));},
    execute:async(room,bot,message,meta,execution)=>{agentExecutions.set(message.id,execution);try{await run(room,bot,message,undefined,meta);}finally{agentExecutions.delete(message.id);}},
    synthesize:async(room,bot,message,meta,signal)=>{agentExecutions.set(message.id,{id:'synthesis',signal});try{await run(room,bot,message,undefined,meta);}finally{agentExecutions.delete(message.id);}},
  });

  function run(room: Room, bot: Bot, message: LedgerEvent, resume?: Resume, meta?: TurnMeta, recoveredAdmission = false): Promise<void> {
    if (shuttingDown) return Promise.reject(new Error("Daemon is shutting down"));
    const job = runAdmitted(room, bot, message, resume, meta, recoveredAdmission);
    runs.add(job);
    void job.then(() => runs.delete(job), () => runs.delete(job));
    return job;
  }

  async function runAdmitted(room: Room, bot: Bot, message: LedgerEvent, resume?: Resume, meta?: TurnMeta, recoveredAdmission = false): Promise<void> {
    const requestExecution=agentExecutions.get(message.id);
    if(meta?.agentRequestId && requestExecution?.id!==meta.agentRequestId)throw Error('Agent request admission is unavailable');
    if(meta?.agentRequestResult && requestExecution?.id!=='synthesis')throw Error('Consultation synthesis admission is unavailable');
    const investigation=investigations.get(message.id);
    if(meta?.investigationId&&(!investigation||investigation.id!==meta.investigationId))throw new Error('Investigation admission is unavailable');
    if(investigation&&(bot.runtime!=='api'||!investigation.valid()||investigation.signal.aborted))throw new Error('Investigation scope or runtime is unavailable');
    if(message.roomId!==room.id||message.type!=="message"||!db.prepare("SELECT 1 FROM room_members WHERE room_id=? AND bot_id=?").get(room.id,bot.id))throw new Error("Turn does not belong to this conversation.");
    const restored=resume?(db.prepare("SELECT work_id FROM work_runs WHERE turn_id=?").get(resume.turnId) as {work_id:string}|undefined)?.work_id:undefined;
    const workId=meta?.workId??restored;
    const task: {workId?:string;runId:string;duplicate?:boolean} = workId
      ? work.begin({roomId:room.id,botId:bot.id,messageId:message.id,workId,turnId:resume?.turnId,claim:true})
      : {runId:randomUUID()};
    if(task.duplicate)return;
    const chatKey=JSON.stringify([room.id,bot.id,message.id]);
    if(!workId&&!resume){
      if(chatClaims.has(chatKey))return;
      const inserted=db.prepare("INSERT OR IGNORE INTO chat_dispatches(room_id,bot_id,message_id,context_json) VALUES(?,?,?,?)").run(room.id,bot.id,message.id,JSON.stringify(redactor.redact(meta??{}))).changes;
      if(!inserted&&(!recoveredAdmission||!db.prepare('SELECT 1 FROM chat_dispatches WHERE room_id=? AND bot_id=? AND message_id=? AND turn_id IS NULL AND settled_at IS NULL').get(room.id,bot.id,message.id)))return;
      chatClaims.add(chatKey);
    }
    const cancelled=()=>!!(task.workId??meta?.sourceWorkId)&&work.cancelled((task.workId??meta?.sourceWorkId)!);
    admissions.set(bot.id, (admissions.get(bot.id) ?? 0) + 1);
    const controller = new AbortController();
    workControllers.set(task.runId, { workId: task.workId??meta?.sourceWorkId, controller });
    let release: (() => void) | undefined;
    let outcome: "completed" | "incomplete" | "failed" | "interrupted" | "cancelled" = "failed";
    let reason: string | undefined;
    try {
      while (configuring.has(bot.id)) await configuring.get(bot.id);
      bot = getBot(db, bot.id) ?? bot;
      if (cancelled()) { outcome = "cancelled"; return; }
      release = await acquire(`${bot.id}:${room.id}`,investigation?.signal??requestExecution?.signal);
      bot=getBot(db,bot.id)??bot;
      if(investigation&&(bot.runtime!=='api'||!investigation.valid()||investigation.signal.aborted))throw new Error('Investigation scope or runtime changed');
      const done = () => { release?.(); release = undefined; };
      if (shuttingDown) { outcome = "interrupted"; return; }
      if (cancelled()) { outcome = "cancelled"; return; }
      outcome = await runTurn(room, bot, message, resume, meta, done, task, AbortSignal.any([controller.signal,...(investigation?[investigation.signal]:[]),...(requestExecution?[requestExecution.signal]:[])]));
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      chatClaims.delete(chatKey);
      admissions.set(bot.id, admissions.get(bot.id)! - 1);
      release?.();
      workControllers.delete(task.runId);
      if (!shuttingDown) { if(task.workId)work.updateRun(task.runId, outcome, reason); else db.prepare('UPDATE chat_dispatches SET settled_at=? WHERE room_id=? AND bot_id=? AND message_id=?').run(Date.now(),room.id,bot.id,message.id); questions.finished(message.id); }
    }
  }

  async function runTurn(
    room: Room,
    bot: Bot,
    message: LedgerEvent,
    resume: Resume | undefined,
    meta: TurnMeta | undefined,
    done: () => void,
    task: { workId?: string; runId: string },
    upstreamSignal: AbortSignal,
  ): Promise<"completed" | "incomplete" | "failed" | "interrupted" | "cancelled"> {
    const permissionEnd=new AbortController();
    const signal=AbortSignal.any([upstreamSignal,permissionEnd.signal]);
    const cancelled=()=>!!(task.workId??meta?.sourceWorkId)&&work.cancelled((task.workId??meta?.sourceWorkId)!);
    const investigation=investigations.get(message.id);
    const authorityWorkId=task.workId??meta?.sourceWorkId;
    const now = Date.now();
    const answer=(message.payload as {text?:string}).text??'';
    const input=questions.delivery(message.id,bot.id,room.id);
    const text=input?questionAnswerContext(input.question,answer,input.question.workId?work.get(input.question.workId)?.request:undefined):answer;
    let turnId: string;
    const state: Record<string, unknown> = resume
      ? { ...resume.state }
      : {
          messageId: message.id,
          ...Object.fromEntries(Object.entries(meta ?? {}).filter(([, v]) => v !== undefined)),
          ...(((src) => (src ? { source: src, noIndex: true } : {}))(meta?.source ?? sourceOf(message))),
        };
    if(state.permissionParents!==undefined&&(!Array.isArray(state.permissionParents)||state.permissionParents.length>MAX_HOPS+1))throw Error('Invalid inherited permission scope');
    const permissionParents:readonly PermissionReference[]=Object.freeze(((state.permissionParents??[]) as PermissionReference[]).map(ref=>Object.freeze({...ref})));
    Object.defineProperty(state,'permissionParents',{value:permissionParents,writable:false,configurable:false,enumerable:true});
    const parentScopes=()=>permissionParents.map(ref=>{
      const session=permissions.get(ref.botId,ref.roomId);
      if(!session||session.id!==ref.id||session.revision!==ref.revision||!permissions.valid(session))throw new ActionFailure('An inherited permission revision changed. A fresh delegation is required.','not-run');
      return session;
    });
    const library = getSetting(db, "skillLibrary");
    const skillLibraryConfig = JSON.stringify({ enabled: library.enabled, assigned: Object.hasOwn(library.assignments, `agent:${bot.id}`) ? library.assignments[`agent:${bot.id}`] : [] });
    if (state.skillLibraryConfig !== skillLibraryConfig) delete state.acpSessionId;
    state.skillLibraryConfig = skillLibraryConfig;
    const turnPolicy = Object.freeze({ unattended: state.unattended === true, allowApprovals: state.allowApprovals === true, isolated: state.isolated === true, noNetwork: state.noNetwork === true });
    // Runtime session state stays writable; policy flags cannot be changed or persisted as an escalation.
    for (const [key, value] of Object.entries(turnPolicy)) Object.defineProperty(state, key, { value, writable: false, configurable: false, enumerable: true });
    Object.defineProperty(state,"noIndex",{value:state.noIndex===true,writable:false,configurable:false,enumerable:true});
    Object.defineProperty(state,"workId",{value:task.workId,writable:false,configurable:false,enumerable:true});
    // Turn budget (OA-309): counts turns over a rolling 24 h, not dollars. A resumed turn is never blocked (an approved
    // action must finish). Blocked = no turn row; a failed turn_finished so callers (reflection, automations) see a failure.
    if (!resume) {
      const limits = getSetting(db, "limits");
      const since = now - 24 * 3_600_000;
      const perBot = limits.maxTurnsPerBotPerDay > 0 && (db.prepare("SELECT COUNT(*) AS n FROM turns WHERE bot_id = ? AND created_at > ?").get(bot.id, since) as { n: number }).n >= limits.maxTurnsPerBotPerDay;
      const unattended =
        state.unattended === true &&
        limits.maxUnattendedPerDay > 0 &&
        (db.prepare("SELECT COUNT(*) AS n FROM turns WHERE created_at > ? AND json_extract(state_json, '$.unattended') = 1").get(since) as { n: number }).n >= limits.maxUnattendedPerDay;
      if (perBot || unattended) {
        ledger.append(room.id, bot.id, "error", { message: "daily turn limit reached" });
        ledger.append(room.id, bot.id, "turn_finished", { turnId: null, status: "failed", workId: task.workId });
        return "failed";
      }
    }
    turnId = resume?.turnId ?? randomUUID();
    ledger.atomic(()=>{
    if(bot.runtime==='api'&&state.hostedHistoryThroughId===undefined)state.hostedHistoryThroughId=(db.prepare('SELECT coalesce(max(id),0) id FROM events WHERE room_id=?').get(room.id) as {id:number}).id;
    if (resume) {
      setTurn.run("running", now, turnId);
    } else {
      db.prepare(
        "INSERT INTO turns (id, room_id, bot_id, status, state_json, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?, ?)",
      ).run(turnId, room.id, bot.id, JSON.stringify(redactor.redact(state)), now, now);
    }
    if(task.workId)work.updateRun(task.runId, "running", undefined, turnId);
    else db.prepare("UPDATE chat_dispatches SET turn_id=? WHERE room_id=? AND bot_id=? AND message_id=?").run(turnId,room.id,bot.id,message.id);
    questions.started(message.id);
    ledger.append(room.id, bot.id, "turn_started", { turnId, messageId: message.id, resumed: !!resume, workId: task.workId });
    });

    const persist = () =>
      db.prepare("UPDATE turns SET state_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(redactor.redact(state)),
        Date.now(),
        turnId,
      );

    // A pregrant satisfies one `ask` for a matching call. It is consumed on use, so it can never approve twice.
    const consumePregrant = (toolName: string, args: unknown, toolCallId?: string): boolean | string => {
      const grant = state.pregrant as Pregrant | undefined;
      if (!grant || !pregrantMatches(grant, toolName, args)) return false;
      if (grant.toolCallId && toolCallId) work.linkTool(turnId, toolCallId, grant.toolCallId);
      delete state.pregrant;
      persist();
      return grant.approvalId ?? true;
    };

    // Aborted when the turn ends (not on daemon shutdown), so approvals still pending for it are expired, not orphaned.
    const turnEnd = new AbortController();
    const inputEnd = new AbortController();
    let awaitingInput = false;
    let yieldInput!: () => void;
    const inputPaused = new Promise<void>(resolve => { yieldInput = resolve; });
    const pauseForInput = (prompt:string|null, toolCallId?:string) => {
      if (state.unattended || state.isolated || room.id.startsWith("_") || signal.aborted || turnEnd.signal.aborted || executingTools.size) throw new Error("This turn cannot request input now.");
      const question = questions.request(task.workId??null,turnId,prompt,toolCallId);
      awaitingInput = true;
      return question;
    };
    const yieldForInput = () => { inputEnd.abort(); yieldInput(); };
    const waitOpts = (opts?: GateOptions): GateOptions => ({
      ...opts,
      signal: AbortSignal.any([signal, turnEnd.signal, inputEnd.signal, ...(opts?.signal ? [opts.signal] : [])]),
      keepPending: () => shuttingDown,
    });

    const roster = room.members.map((id) => getBot(db, id)).filter((b): b is Bot => b !== undefined);
    const outputParts: string[] = [];
    if(!investigation&&!state.agentRequestId)ensureMemoryFile(deps.dataDir, bot);
    const memory = investigation||state.agentRequestId?'':readMemoryHead(deps.dataDir, bot.id);
    const recall = !investigation&&!state.agentRequestId&&bot.runtime==='acp'&&vectors ? (await vectors.search(bot.id, resume?.prompt ?? text, 4)).map((h) => h.text) : [];

    const promptPermission=permissions.active()?permissions.ensure(bot.id,room.id):undefined;
    // A self-reference enforces the original revision without changing the effective adapter context.
    const contextParents=permissionParents.filter(ref=>ref.id!==promptPermission?.id);
    const permissionContext=promptPermission?JSON.stringify({id:promptPermission.id,revision:promptPermission.revision,parents:contextParents}):undefined;
    if(state.permissionContext!==permissionContext)delete state.acpSessionId;
    Object.defineProperty(state,'permissionContext',{value:permissionContext,writable:false,configurable:false,enumerable:true});
    let modeGuidance:string|undefined=permissions.active()?undefined:'Permission replacement awaits owner adoption in Server settings. Tools are unavailable. Do not use another channel or credentials to bypass this requirement.';
    if(promptPermission){try{modeGuidance=permissionGuidance(promptPermission,intersectPermissions(promptPermission,parentScopes()),turnPolicy);}catch{modeGuidance='Inherited permission scope is unavailable. Do not dispatch operations or try another channel; ask the owner for a fresh scope.';}}
    state.guestHistoryRevision=agentRequests.historyRevision(room.id,bot.id,message.id);
    const fork=state.isolated===true||state.noIndex===true||typeof state.source==='string'||investigation?undefined:forkContext(db,room.id);
    const promptInput={bot,room,roster,fork,permission:modeGuidance,body:messageWithReply(message,resume?.prompt??text),memory,recall,
      capabilities:state.isolated===true?undefined:deps.capabilityGuidance?.(),
      knowledge:getDefaultBotId(db)===bot.id?knowledge.index():undefined,
      skills:investigation?undefined:skills.index(bot.id)};
    let hostedInput:HostedInput|undefined;
    let acpHistory:string|null|undefined;
    let acpContext:ContextProjection|undefined;
    if(bot.runtime==='api'||(bot.runtime==='acp'&&!investigation)){
      try{
        const boundaryKey=bot.runtime==='api'?'hostedHistoryThroughId':'acpHistoryThroughId';
        const history=ledger.conversationHistory({roomId:room.id,botId:bot.id,messageId:message.id,
          throughId:state[boundaryKey] as number|undefined,afterId:state.historyAfterId as number|undefined});
        for(const [key,value]of Object.entries({[boundaryKey]:history.throughId,historyAfterId:state.historyAfterId??0}))Object.defineProperty(state,key,{value,writable:false,configurable:false,enumerable:true});
        persist();
        const excluded=state.isolated===true||state.noIndex===true||typeof state.source==='string'||room.id.startsWith('_');
        if(bot.runtime==='api')hostedInput={...buildHostedInput(promptInput,excluded?[]:history.messages,message.actor,typeof state.source==='string'?state.source:undefined),historyOmitted:excluded?0:history.omitted,historyOmittedRange:excluded?undefined:history.omittedRange,historyBoundary:history.throughId};
        else {
          const sources=[contextDescriptor('current',promptInput.body,promptInput.body)];
          for(const [source,content] of [['instructions',(bot.config as {instructions?:string})?.instructions],['permission',promptInput.permission],['capabilities',promptInput.capabilities],['fork',promptInput.fork],['memory',promptInput.memory?.trimEnd()],['help',promptInput.knowledge],['skills',promptInput.skills?.trimEnd()]] as const)if(content)sources.push(contextDescriptor(source,content,content));
          for(const hit of recall){const content=hit.replace(/[\r\n]+/g,' ').slice(0,600);sources.push(contextDescriptor('recall',hit,content,undefined,hit.length>600?'source-clipped':undefined));}
          acpHistory=buildAcpHistory(excluded?[]:history.messages,selected=>sources.push(...selected));
          acpContext={sources,historyOmitted:excluded?0:history.omitted??0,historyOmittedRange:excluded?undefined:history.omittedRange,historyBoundary:history.throughId,measurement:'javascript-string-length',limit:null,requiredCharacters:0,upstreamLoss:'unavailable'};
        }
      }catch{if(bot.runtime==='api')hostedInput={instructions:'',current:'',history:[],data:[],invalid:true};else acpHistory=null;}
    }
    const operationScope=(exec:ReturnType<typeof executor>,args:unknown,permission?:import('../execution.js').ExecutionPolicy):EffectScope=>protectScope(exec?.effectScope?.({botId:bot.id,dataDir:deps.dataDir,roomId:room.id,permission,turnPolicy},args),value=>redactor.redact(value));
    const executingTools = new Set<Promise<unknown>>();
    if(investigation)hostedInput={instructions:investigation.instructions,current:text,history:[],data:[]};
    const ctx: TurnContext = {
      investigation,room,bot,message,
      prompt:investigation?investigation.instructions+'\n'+text:buildPrompt(promptInput),
      hostedInput,
      acpHistory,acpContext,
      get awaitingInput() { return awaitingInput; },
      loadHostedRecall:async()=>!investigation&&!state.agentRequestId&&vectors?(await vectors.search(bot.id,resume?.prompt??text,4)).slice(0,4).map(hit=>({source:`recall:${hit.source}`,content:hit.text.slice(0,600)})):[],
      resumed: !!resume,
      turnId,
      workId: task.workId,
      signal: AbortSignal.any([signal, turnEnd.signal,inputEnd.signal]),
      reportWork: report => {
        if (shuttingDown || turnEnd.signal.aborted || signal.aborted || awaitingInput) return;
        // Older adapters report a need for input without supplying a question.
        if (report.needsInput && (state.unattended || state.isolated || room.id.startsWith("_"))) return;
        ledger.atomic(()=>{if(task.workId)work.report(task.workId,report);if(report.needsInput)pauseForInput(null);});
        if(report.needsInput)yieldForInput();
      },
      ledger,
      state,
      saveState(patch) {
        if (shuttingDown || turnEnd.signal.aborted || awaitingInput) return;
        Object.assign(state, patch);
        persist();
      },
      toolCalls: 0,
      startAction(id,toolCallId) {
        if(awaitingInput || turnEnd.signal.aborted || signal.aborted)throw new ActionFailure("Turn already ended.","not-run");
        const a=deps.approvals.get(id);
        if(!a || a.turnId!==turnId || a.botId!==bot.id || a.roomId!==room.id)throw new ActionFailure("Approval does not belong to this turn.","not-run");
        if(a.review?.nativeFiles && !checkNativeFiles(deps.dataDir,bot.id,a.review)){
          receipts.finish(id,{outcome:"not-run",detail:"A native file changed after review. The adapter was refused permission."});
          throw new ActionFailure("A reviewed file changed; request a new proposal.","not-run");
        }
        receipts.start(id,turnId,toolCallId??a.toolCallId);
      },
      finishAction(id,evidence) {
        const a=deps.approvals.get(id);
        if(a?.turnId===turnId && a.botId===bot.id && a.roomId===room.id){
          if(a.review?.nativeFiles && evidence.outcome==="completed"){
            let matched=false;try{matched=checkNativeFiles(deps.dataDir,bot.id,a.review,true);}catch{}
            evidence={outcome:matched?"completed":"unknown",detail:matched?"The daemon read back the exact reviewed file changes after the adapter finished.":"Adapter completion did not match the reviewed file contents. Inspect the files before any repeat."};
          }
          receipts.finish(id,evidence);
          return receipts.get(id)?.outcome;
        }
      },
      authorize: async (toolName, args, opts) => {
        if(state.agentRequestId && ['agent_consult','agent_request_cancel','create_work','memory_append','request_input','save_result'].includes(toolName))return {allowed:false,status:'denied',message:'This bounded agent request cannot delegate, create Work, change memory or request input.'};
        if(['agent_consult','agent_request_cancel'].includes(toolName)&&(state.unattended||state.isolated||(toolName==='agent_consult'&&state.noNetwork)||state.agentRequestResult||state.agentRequestId||state.source||investigation||!mayDelegate(bot,room)))return {allowed:false,status:'denied',message:'Consultation is unavailable under this turn scope.'};
        if(toolName==='investigation_read'&&!investigation)return {allowed:false,status:'denied',message:'This read requires a trusted investigation'};
        if(investigation&&(toolName!=='investigation_read'||!investigation.valid()||investigation.signal.aborted))return {allowed:false,status:'denied',message:'Investigation scope forbids this operation'};
        if (shuttingDown || signal.aborted || turnEnd.signal.aborted || awaitingInput || cancelled()) return { allowed: false, status: "denied", message: "work cancellation requested" };
        if(!permissions.active())return {allowed:false,status:'denied',message:'Permission adoption is required in Server settings. No tool was dispatched.'};
        if(toolName === "request_input") {
          if(state.unattended || state.isolated || room.id.startsWith("_"))return {allowed:false,status:"denied",message:"Background turns cannot request input."};
          try { const value=executor(toolName)?.validate?.(args); if(!value)throw Error("Input tool unavailable"); return {allowed:true,args:value,effectScope:{kind:'read'}}; }
          catch {return {allowed:false,status:"denied",message:"A bounded question is required."};}
        }
        let cls = classify(toolName);
        const restriction = turnPolicy.isolated?'isolated':turnPolicy.noNetwork&&executor(toolName)?.offlineSafe!==true?'offline':null;
        if (restriction) return { allowed: false, status: "denied", message: restriction === "isolated" ? "this turn has no tools" : restriction === "offline" ? "this turn is offline" : `unattended turns cannot use ${toolName} (${cls}) with its current permission mode` };

        const permissionSession=permissions.ensure(bot.id,room.id);
        let effective:ReturnType<typeof intersectPermissions>|undefined;
        try{if(permissionSession)effective=intersectPermissions(permissionSession,parentScopes());else if(permissionParents.length)throw Error('Inherited permission scope is unavailable');}catch(error){return {allowed:false,status:'denied',message:redactor.redactString(error instanceof Error?error.message:'Inherited permission scope is unavailable')};}
        const boundary=effective?.policy;
        let requirement:import('../tools/registry.js').PermissionRequirement={approval:'review'};
        let review: Record<string,unknown> | undefined;
        let scope:EffectScope={kind:"opaque"};
        try {
          const exec=executor(toolName);
          if(exec?.validate)args=exec.validate(args);
          if(permissionSession){requirement=exec?.permission?.({botId:bot.id,dataDir:deps.dataDir,roomId:room.id,turnId,turnPolicy,permission:boundary,permissionApproval:effective!.approval},args)??{approval:'review'};cls=operationClass(toolName,requirement);requirement=sessionRequirement(requirement,cls,turnPolicy);}
          scope=operationScope(exec,args,boundary);
          review=exec?.review?.({botId:bot.id,dataDir:deps.dataDir,roomId:room.id,workId:task.workId,turnId,messageId:message.id,toolCallId:opts?.toolCallId,turnPolicy,investigation},args)??nativeFileReview(deps.dataDir,bot.id,toolName,args);
        }catch(error){return {allowed:false,status:"denied",message:redactor.redactString(error instanceof Error?error.message:"Invalid proposal")};}
        if(requirement.execution&&!scopeAllows(requirement.execution,parentScopes()))return {allowed:false,status:'denied',message:'A scoped escalation cannot exceed the inherited delegation boundary. A fresh parent scope is required.'};
        if(permissionSession&&turnToolRestriction(cls,sessionToolMode(effective!.approval,requirement).mode,turnPolicy,executor(toolName)?.offlineSafe===true))return {allowed:false,status:'denied',message:'This turn cannot use the operation under its effective permission and offline/background ceilings.'};
        const blocking=receipts.blocker(scope);
        if(blocking)return {allowed:false,status:"denied",...conflictDetails(blocking,room.id)};

        const result = await gate.authorize({ roomId: room.id, botId: bot.id, turnId, toolName, args, ...(permissionSession?{permission:{session:permissionSession,requirement,approvalPolicy:effective!.approval}}:{}), review:{...review,effectScope:scope,...(permissionSession?{permissionParents,permissionSessionId:permissionSession.id,permissionRevision:permissionSession.revision,permission:{preset:permissionSession.preset,sessionId:permissionSession.id,revision:permissionSession.revision,execution:requirement.execution??boundary,approvalPolicy:effective!.approval,parents:permissionParents}}:{}),workId:task.workId,requestId:message.id}, toolCallId: opts?.toolCallId, source: typeof state.source === "string" ? state.source : null }, (name, value) => consumePregrant(name, value, opts?.toolCallId), waitOpts(opts));
        if (shuttingDown || signal.aborted || turnEnd.signal.aborted || awaitingInput || cancelled()) {
          if(result.allowed && result.approvalId && !shuttingDown)receipts.finish(result.approvalId,{outcome:"not-run",detail:"Cancellation prevented execution."});
          return { allowed: false, status: "denied", message: "work cancellation requested" };
        }
        if(permissionSession&&(!permissions.valid(permissionSession)||permissionParents.some(ref=>{const current=permissions.get(ref.botId,ref.roomId);return !current||current.id!==ref.id||current.revision!==ref.revision||!permissions.valid(current);}))) {
          if(result.allowed&&result.approvalId)receipts.finish(result.approvalId,{outcome:'not-run',detail:'Permission revision changed before dispatch.'});
          return {allowed:false,status:'denied',message:'Permission revision changed. Submit a new operation if still appropriate; nothing was replayed.'};
        }
        return result.allowed ? {...result,effectScope:scope,permissionSession,toolClass:cls,permissionApproval:effective?.approval,permissionRequirement:requirement,executionPolicy:requirement.execution??boundary,contractVersion: typeof review?.contractVersion === "string" ? review.contractVersion : undefined} : result;
      },
      async callTool(toolName, args, opts) {
        if (shuttingDown || signal.aborted || turnEnd.signal.aborted || awaitingInput || cancelled()) return { ok: false, status: "denied", message: "work cancellation requested" };
        ctx.toolCalls++;
        const toolCallId = randomUUID();
        const control=toolName==="request_input"?{control:"request_input"}:{};
        ledger.append(room.id, bot.id, "tool_call", { turnId, toolCallId, tool: toolName, args,...control });
        if(bot.runtime==='api'&&(state.hostedStop||(toolName!=='request_input'&&Number(state.hostedExecutedTools??0)>=hostedLimits(ctx).maxTools))){
          const reason=(state.hostedStop??'tool_limit') as import('./hosted-execution.js').StopReason;stopHosted(ctx,reason);
          const outcome={ok:false as const,status:'denied' as const,executionOutcome:'not-run' as const,stopReason:reason,message:`Not run: ${reason}. Review the partial result before continuing.`};
          ledger.append(room.id,bot.id,'tool_result',{turnId,toolCallId,tool:toolName,...control,...outcome});return outcome;
        }
        const auth = await ctx.authorize(toolName, args, { ...opts, toolCallId });
        if (!auth.allowed) {
          const outcome = { ok: false as const, status: auth.status, message: auth.message,...(auth.reason?{reason:auth.reason,nextStep:auth.nextStep,...(auth.blockingReceiptId?{blockingReceiptId:auth.blockingReceiptId}:{})}:{}) };
          if (!shuttingDown) ledger.append(room.id, bot.id, "tool_result", { turnId, toolCallId, tool: toolName,...control, ...outcome });
          return outcome;
        }
        const receiptId=auth.approvalId??(auth.permissionSession?receipts.automatic({roomId:room.id,botId:bot.id,turnId,toolCallId,toolName,toolClass:auth.toolClass,args:auth.args,workId:task.workId},auth.permissionSession,auth.executionPolicy,{effectScope:auth.effectScope,approvalPolicy:auth.permissionApproval,parents:permissionParents}):undefined);
        const dynamic = deps.dynamicTools?.() ?? {};
        // Own properties only: a tool named like an Object.prototype member (e.g. "constructor") must not resolve.
        const exec = Object.hasOwn(deps.tools, toolName)
          ? deps.tools[toolName]
          : Object.hasOwn(dynamic, toolName)
            ? dynamic[toolName]
            : undefined;
        if (!exec) {
          if(receiptId)receipts.finish(receiptId,{outcome:"not-run",detail:"No executor is available."});
          const outcome = { ok: false as const, status: "error" as const, message: `unknown tool ${toolName}` };
          if (!shuttingDown) ledger.append(room.id, bot.id, "tool_result", { turnId, toolCallId, tool: toolName,...control, ...outcome });
          return outcome;
        }
        let executionStarted=false;
        try {
          if (shuttingDown || signal.aborted || turnEnd.signal.aborted || awaitingInput) throw new ActionFailure("work cancellation requested","not-run");
          if(investigation&&(!investigation.valid()||investigation.signal.aborted||toolName!=='investigation_read'))throw new ActionFailure('Investigation scope changed','not-run');
          const executionReview=exec.review?.({botId:bot.id,dataDir:deps.dataDir,roomId:room.id,workId:task.workId,turnId,messageId:message.id,toolCallId,turnPolicy,investigation},auth.args);
          const approvedContract=auth.approvalId?deps.approvals.get(auth.approvalId)?.review?.contractVersion:auth.contractVersion;
          if(approvedContract && executionReview?.contractVersion!==approvedContract)throw new ActionFailure("The tool contract changed. Review a fresh proposal.","not-run");
          const validated=exec.validate?.(auth.args)??auth.args;
          if(canonical(validated)!==canonical(auth.args))throw new ActionFailure("The tool schema changed the reviewed payload. Request a new proposal.","not-run");
          if(receiptId && canonical(redactor.redact(auth.args))!==canonical(receipts.get(receiptId!)?.effective))throw new ActionFailure("Execution arguments differ from the approved snapshot.","not-run");
          if(bot.runtime==='api'&&state.hostedStop)throw new ActionFailure(String(state.hostedStop),'not-run');
          if(bot.runtime==='api'&&toolName!=='request_input'){
            const count=Number(state.hostedExecutedTools??0),limit=hostedLimits(ctx).maxTools;
            if(count>=limit){stopHosted(ctx,'tool_limit');throw new ActionFailure('tool_limit','not-run');}
            state.hostedExecutedTools=count+1;persist();
          }
          let dispatchRequirement=auth.permissionSession?exec.permission?.({botId:bot.id,dataDir:deps.dataDir,roomId:room.id,turnId,turnPolicy,permission:intersectPermissions(auth.permissionSession,parentScopes()).policy,permissionApproval:auth.permissionApproval},auth.args)??{approval:'review' as const}:undefined;
          if(dispatchRequirement)dispatchRequirement=sessionRequirement(dispatchRequirement,operationClass(toolName,dispatchRequirement),turnPolicy);
          if(auth.permissionSession&&canonical(dispatchRequirement)!==canonical(auth.permissionRequirement))throw new ActionFailure('Tool permission requirements changed. Submit a fresh operation.','not-run');
          if(auth.permissionSession&&!permissions.valid(auth.permissionSession))throw new ActionFailure('Permission revision changed before dispatch. Submit a fresh operation.','not-run');
          const dispatchScope=operationScope(exec,auth.args,auth.executionPolicy);
          if(canonical(dispatchScope)!==canonical(auth.effectScope??{kind:'opaque'}))throw new ActionFailure('Effect target changed. Request a fresh proposal.','not-run');
          if(auth.approvalId)ctx.startAction!(auth.approvalId,toolCallId);
          else if(receiptId)receipts.start(receiptId,turnId,toolCallId);
          executionStarted=true;
          const execution = exec({
            agentList:()=>agentRequests.agents(),
            cancelAgentRequests:id=>agentRequests.cancelFor(room.id,bot.id,id),
            consultAgent:args=>{if(!auth.permissionSession)throw Error('Permission context unavailable');return agentRequests.admit(args,{room,message,botId:bot.id,turnId,workId:task.workId,key:`consult:${turnId}:${opts?.toolCallId??toolCallId}`,parents:[...permissionParents,permissionReference(auth.permissionSession)]},'consultation');},
            botId: bot.id, dataDir: deps.dataDir, roomId: room.id, workId: task.workId, turnId, toolCallId,messageId:message.id,createWork:(args,key)=>work.create({roomId:room.id,botId:bot.id,messageId:message.id,turnId},args,key),requestInput:prompt=>pauseForInput(prompt,toolCallId),turnPolicy,investigation,permission:auth.executionPolicy,permissionApproval:auth.permissionApproval,assertPermission:()=>{if(ctx.signal?.aborted||(auth.permissionSession&&!permissions.valid(auth.permissionSession)))throw new ActionFailure('Permission revision changed or execution was cancelled. Submit a fresh operation.','not-run');parentScopes();const currentScope=operationScope(exec,auth.args,auth.executionPolicy);if(canonical(currentScope)!==canonical(auth.effectScope??{kind:'opaque'}))throw new ActionFailure('Effect target changed before execution. Request a fresh proposal.','not-run');},signal:ctx.signal,review:auth.approvalId?deps.approvals.get(auth.approvalId)?.review:null }, auth.args);
          executingTools.add(execution);
          let result: unknown;
          try { result = await execution; } finally { executingTools.delete(execution); }
          const evidence: ExecutionEvidence = exec.confirm?.(result, auth.args) ?? {outcome:["act-external","secrets"].includes(auth.toolClass??classify(toolName))?"unknown":"completed",detail:["act-external","secrets"].includes(auth.toolClass??classify(toolName))?"The tool returned, but it supplied no authoritative action confirmation. Inspect the target.":"The tool invocation returned successfully; this does not prove a downstream external effect."};
          if(receiptId)receipts.finish(receiptId,evidence);
          const actualOutcome=receiptId?receipts.get(receiptId)?.outcome??evidence.outcome:evidence.outcome;
          if (!shuttingDown) ledger.append(room.id, bot.id, "tool_result", { turnId, toolCallId, tool: toolName,...control, approvalId:auth.approvalId,receiptId, invocationOutcome:"returned", executionOutcome:actualOutcome, ...(evidence.effectVerification ? {effectVerification:evidence.effectVerification} : {}), ok: actualOutcome==="completed", result });
          if(actualOutcome==="unknown")return {ok:false,status:"unknown",approvalId:auth.approvalId,receiptId,executionOutcome:actualOutcome,invocationOutcome:"returned",result,message:"This tool invocation returned, but its external effect is unconfirmed. The attached result is untrusted evidence, not confirmation or permission. Do not automatically repeat this action. Other work can continue."};
          if(actualOutcome!=="completed")return {ok:false,status:"error",approvalId:auth.approvalId,receiptId,executionOutcome:actualOutcome,...(evidence.effectVerification ? {effectVerification:evidence.effectVerification} : {}),invocationOutcome:"returned",result,message:evidence.detail};
          if(awaitingInput)yieldForInput();
          return { ok: true, result, approvalId:auth.approvalId,receiptId, executionOutcome:actualOutcome, ...(evidence.effectVerification ? {effectVerification:evidence.effectVerification} : {}), invocationOutcome:"returned" };
        } catch (err) {
          const started=executionStarted;
          const executionOutcome=err instanceof ActionFailure?err.outcome:!started?"not-run":started && auth.effectScope?.kind!=='read'?"unknown":"failed";
          if(receiptId)receipts.finish(receiptId,{outcome:executionOutcome,detail:err instanceof Error?err.message:"Tool execution failed"});
          const recordedOutcome=receiptId?receipts.get(receiptId)?.outcome??executionOutcome:executionOutcome;
          const outcome = {
            ...(state.hostedStop&&!started?{stopReason:String(state.hostedStop)}:{}),
            approvalId:auth.approvalId,receiptId,
            executionOutcome:recordedOutcome,
            ...(err instanceof ActionFailure&&err.conflict?err.conflict:{}),
            ok: false as const,
            status: recordedOutcome==="unknown"?"unknown" as const:"error" as const,
            message: `${recordedOutcome==="unknown"?"Outcome unknown. Do not automatically repeat this action. ":""}${err instanceof Error ? err.message : String(err)}`,
          };
          if (!shuttingDown) ledger.append(room.id, bot.id, "tool_result", { turnId, toolCallId, tool: toolName,...control, ...outcome });
          return outcome;
        }
      },
    };

    // Redact the returned outcome too: ledger redaction alone does not protect adapters from executor errors.
    const dispatchTool=ctx.callTool;
    ctx.callTool=async(...args)=>redactor.redact(await dispatchTool(...args));

    let status: "finished" | "incomplete" | "failed" | "cancelled" | "interrupted" = "finished";
    let runtimeSettled = true;
    let runtimeRun:Promise<unknown>|undefined;
    let runtimeOutcome:RuntimeOutcome|void=undefined;
    let errorMessage = "";
    const unsubscribe = ledger.subscribe(room.id, (event) => {
      const p = event.payload as { turnId?: unknown; text?: unknown };
      if (event.type === "bot_output" && p.turnId === turnId && typeof p.text === "string") outputParts.push(p.text);
    });
    const key = turnKey(bot.id, room.id);
    activeTurns.set(key, ctx);
    const unwatchPermission=ledger.subscribe('_system',event=>{
      const p=event.payload as {action?:string;sessionId?:string};
      if(event.type==='config'&&(p.action==='permission_adopted'||p.action==='permission_session_changed'&&(p.sessionId===promptPermission?.id||permissionParents.some(ref=>ref.id===p.sessionId)))){
        permissionEnd.abort(new Error('Permission revision changed. Active execution was cancelled where supported; inspect retained outcomes before continuing.'));
      }
    });
    // Watchdog: a turn with no ledger activity for too long (and not waiting on a pending approval, which has its own
    // bounds) is ended as failed, so a hung adapter cannot hold the room lock or leave a run "running" forever.
    const idleMs = state.unattended === true ? (deps.watchdog?.unattendedIdleMs ?? 20 * MINUTE) : (deps.watchdog?.idleMs ?? envIdleMs() ?? 10 * MINUTE);
    let lastActivity = Date.now();
    const unwatch = ledger.subscribe(room.id, (event) => {
      if ((event.payload as { turnId?: unknown } | null)?.turnId === turnId) lastActivity = Date.now();
    });
    const pendingApproval = db.prepare("SELECT 1 FROM approvals WHERE turn_id = ? AND status = 'pending' LIMIT 1");
    let watchTimer: NodeJS.Timeout | undefined;
    const stalled = new Promise<never>((_, reject) => {
      watchTimer = setInterval(() => {
        if (pendingApproval.get(turnId) !== undefined || db.prepare("SELECT 1 FROM mcp_interactions WHERE turn_id=? AND status='open'").get(turnId)!==undefined) lastActivity = Date.now();
        else if (Date.now() - lastActivity > idleMs) reject(new TurnStalled(`turn stalled (no activity for ${Math.round(idleMs / MINUTE) || "<1"} min)`));
      }, deps.watchdog?.tickMs ?? 15_000);
      watchTimer.unref?.();
    });
    stalled.catch(() => undefined);
    let abortRuntime:(()=>void)|undefined;
    const runtimeAborted=new Promise<never>((_,reject)=>{abortRuntime=()=>reject(signal.reason??new Error('Execution cancelled'));if(signal.aborted)abortRuntime();else signal.addEventListener('abort',abortRuntime,{once:true});});
    runtimeAborted.catch(()=>undefined);
    try {
      ctx.attachments = agentExecutions.get(message.id)?.attachments ?? uploads.forMessage(room.id, message.id, (message.payload as { attachments?: { id: string }[] }).attachments?.map(file => file.id));
      const runtime = deps.runtimes[bot.runtime];
      if (!runtime) throw new Error(`no ${bot.runtime} runtime registered`);
      signal.throwIfAborted();
      if(bot.runtime==='api')hostedLimits(ctx);
      runtimeSettled = false;
      const running = runtimeRun = Promise.resolve().then(() => runtime.runTurn(ctx)).finally(() => { runtimeSettled = true; });
      running.catch(() => undefined); // an abandoned (stalled) run may still reject later
      try {
        runtimeOutcome=await Promise.race([running, stalled, inputPaused,...(runtimeAborted?[runtimeAborted]:[])]);
        if(runtimeOutcome){status=runtimeOutcome.outcome==='completed'?'finished':runtimeOutcome.outcome;errorMessage=runtimeOutcome.reason??'';}
      } catch (err) {
        if (err instanceof TurnStalled && !signal.aborted) {
          const diagnostic = await Promise.resolve(runtime.abortTurn?.(ctx)).catch(() => undefined);
          if (diagnostic !== undefined) ledger.append(room.id, bot.id, "error", { turnId, message: "stall diagnostic", diagnostic });
        }
        throw err;
      }
    } catch (err) {
      // During shutdown the runtime's teardown ends the turn (by throwing, or by a graceful "cancelled" stop).
      if (!shuttingDown && !awaitingInput) {
        status = !runtimeSettled ? "interrupted" : signal.aborted ? "cancelled" : requestOutcome(ctx)?.outcome==='failed'?'failed':!!state.hostedStop || err instanceof HostedStop || (bot.runtime==='api'&&err instanceof Error&&err.message.startsWith('context_limit:')) ? "incomplete" : "failed";
        errorMessage = status==='incomplete'?String(state.hostedStop??(err instanceof HostedStop?err.reason:'context_limit')):err instanceof Error ? err.message : String(err);
        ledger.append(room.id, bot.id, "error", { turnId, message: errorMessage });
      }
    } finally {
      if (signal.aborted) {
        await Promise.allSettled([...executingTools]);
        if(!runtimeSettled&&runtimeRun){
          let timer:ReturnType<typeof setTimeout>|undefined;
          try{await Promise.race([runtimeRun.catch(()=>undefined),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}finally{clearTimeout(timer);}
        }
        status = runtimeSettled ? "cancelled" : "interrupted";
      }
      if(abortRuntime)signal.removeEventListener('abort',abortRuntime);
      if (activeTurns.get(key) === ctx) activeTurns.delete(key);
      if (watchTimer) clearInterval(watchTimer);
      unwatch();
      unwatchPermission();
      unsubscribe();
      if (!shuttingDown) turnEnd.abort();
    }
    if((status==='incomplete'||status==='failed')&&bot.runtime==='api'){
      // Exhausted recovery can finish without reissuing the approved call; settle its original ledger entry.
      const unstarted=db.prepare(`SELECT id,approval_id,tool_call_id,tool_name FROM action_receipts r WHERE turn_id=? AND outcome='pending' AND started_at IS NULL AND tool_call_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM events e WHERE e.type='tool_result' AND json_extract(e.payload_json,'$.turnId')=r.turn_id AND json_extract(e.payload_json,'$.toolCallId')=r.tool_call_id)`).all(turnId) as {id:string;approval_id:string|null;tool_call_id:string;tool_name:string}[];
      for(const pending of unstarted)ledger.append(room.id,bot.id,'tool_result',{turnId,toolCallId:pending.tool_call_id,tool:pending.tool_name,approvalId:pending.approval_id,receiptId:pending.id,ok:false,status:'denied',executionOutcome:'not-run',stopReason:errorMessage||'step_limit',message:'Not run: this execution stopped before the approved call could start.'});
      if(unstarted.length)delete state.pregrant;
    }
    receipts.recover(turnId);
    // shutdown() already marked in-flight turns interrupted; leave them resumable instead of finishing them.
    if (shuttingDown) return "interrupted";
    setTurn.run(status, Date.now(), turnId);
    const nextAttemptAt=runtimeOutcome?.nextAttemptAt??requestOutcome(ctx)?.nextAttemptAt;
    const waitNotice=nextAttemptAt!==undefined?` Retry not before ${new Date(nextAttemptAt).toISOString()}.`:'';
    if(runtimeOutcome?.outcome==='failed')ledger.append(room.id,bot.id,'error',{turnId,message:`${errorMessage}: ${runtimeOutcome.message??'Hosted model request failed. Check model configuration and provider availability.'}`});
    state.runtimeOutcome={outcome:status==='finished'?'completed':status,reason:awaitingInput?'awaiting_input':errorMessage||undefined,...(nextAttemptAt!==undefined?{nextAttemptAt}:{})};persist();
    ledger.append(room.id, bot.id, "turn_finished", { turnId, status,reason:awaitingInput?'awaiting_input':errorMessage||undefined,nextAttemptAt });
    if(status==='incomplete')ledger.append(room.id,bot.id,'bot_output',{turnId,runtimeDiagnostic:true,text:`Incomplete: ${errorMessage||'Execution stopped before completion'}.${waitNotice} Review partial results before continuing; no action was retried.`});
    if(awaitingInput) { done(); await agentRequests.finishTurn(turnId,false); return "completed"; }
    const memoryReady = !investigation&&!state.agentRequestId&&await dataRepoReady();
    if (shuttingDown) return "interrupted";
    if (memoryReady) await commitMemory(deps.dataDir, `memory: update after turn by ${bot.id}`);
    if (shuttingDown) return "interrupted";
    if(task.workId)work.updateRun(task.runId, status === "interrupted" ? "interrupted" : "draining", (errorMessage+waitNotice) || undefined);
    done(); // the delegation follow-ups below must not hold this bot's turn lock

    const output = outputParts.join("\n").trim();
    if (status === "finished" && state.isolated !== true && state.noIndex !== true) scheduleIndex(bot, turnId, resume?.prompt ?? text, output);
    const hop = typeof state.hop === "number" ? state.hop : 0;
    const delegatedBy = typeof state.delegatedBy === "string" ? state.delegatedBy : undefined;
    const delegatedId = typeof state.delegationId === "string" ? state.delegationId : undefined;
    // Delegated and result turns of an unattended turn stay unattended, with the same approval permission.
    const inherited: TurnMeta = {
      ...(permissionParents.length?{permissionParents}:{}),
      ...(state.providerWait?{providerWait:state.providerWait as ProviderWait}:{}),
      historyAfterId:typeof state.historyAfterId==='number'?state.historyAfterId:undefined,
      ...(state.noIndex===true?{noIndex:true}:{}),
      ...(state.noNetwork===true?{noNetwork:true}:{}),
      ...(state.unattended === true ? { unattended: true, allowApprovals: state.allowApprovals === true ? true : undefined } : {}),
      ...(typeof state.source === "string" ? { source: state.source } : {}),
    };

    // Delegated turns settle before their result goes back, so the whole chain resolves together.
    if (status === "finished" && !signal.aborted) {
      // Only the lead (or an explicitly allowed bot) delegates: a bot that reads untrusted content, like the
      // researcher, must not be able to turn text it echoes into work for another bot.
      const delegations = mayDelegate(bot, room) && !investigation && !state.agentRequestId && !state.agentRequestResult && !agentRequests.hasConsultations(turnId) && state.isolated !== true
        ? parseDelegations(
            output,
            room.members.filter((m) => m !== delegatedBy),
            bot.id,
          )
        : [];
      if (hop >= MAX_HOPS && delegations.length > 0) {
        const ignored = delegations.map((d) => `@${d.target}`).join(", ");
        ledger.append(room.id, bot.id, "error", { turnId, message: `delegation limit reached; ignored ${ignored}` });
      } else {
        const children: Promise<void>[] = [];
        for (const d of delegations) {
          if (shuttingDown || signal.aborted || cancelled()) break;
          const target = getBot(db, d.target);
          if (!target) {
            ledger.append(room.id, bot.id, "error", { turnId, message: `unknown delegate @${d.target}` });
            continue;
          }
          const delegationId = randomUUID();
          const ownScope=permissions.active()?permissions.ensure(bot.id,room.id):undefined;
          const delegatedMeta={ hop: hop + 1, delegatedBy: bot.id, delegationId, workId:task.workId, parentWorkId: task.workId, ...inherited,...(ownScope?{permissionParents:[...permissionParents,permissionReference(ownScope)]}:{}) };
          const msg = ledger.atomic(()=>{
          const assigned = ledger.append(room.id, bot.id, "message", {
            text: d.task,
            delegatedBy: bot.id,
            hop: hop + 1,
            delegationId,
          });
          ledger.append(room.id, bot.id, "route", {
            targets: [d.target],
            delegatedBy: bot.id,
            hop: hop + 1,
            messageId: assigned.id,
            delegationId,
            turnId,
          });
          if(task.workId)work.begin({roomId:room.id,botId:target.id,messageId:assigned.id,workId:task.workId});
          else db.prepare('INSERT INTO chat_dispatches(room_id,bot_id,message_id,context_json) VALUES(?,?,?,?)').run(room.id,target.id,assigned.id,JSON.stringify(redactor.redact(delegatedMeta)));
          return assigned;
          });
          children.push(
            run(room, target, msg, undefined, delegatedMeta,true).catch((err) => {
              ledger.append(room.id, bot.id, "error", {
                turnId,
                message: `delegation to @${d.target} failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            }),
          );
        }
        await Promise.all(children);
      }
    }

    const consultationReply=await agentRequests.finishTurn(turnId,status==='finished'&&!signal.aborted&&!cancelled());

    // A delegated turn always reports back to its delegator, whether it finished or failed.
    if (delegatedBy && !signal.aborted && !cancelled()) {
      const delegator = getBot(db, delegatedBy);
      if (!delegator) {
        ledger.append(room.id, bot.id, "error", { turnId, message: `cannot report to unknown @${delegatedBy}` });
        return "failed";
      }
      const reply = consultationReply
        ? consultationReply.outcome==='completed'?`Result from @${bot.id}: ${consultationReply.text}`:`@${bot.id} ${consultationReply.outcome}: ${consultationReply.text}`
        : status === "finished"
          ? `Result from @${bot.id}: ${output || "(no output)"}`
          : `@${bot.id} ${status}: ${errorMessage}. Partial findings: ${output || "(no output)"}`;
      const msg = ledger.append(room.id, bot.id, "message", {
        text: reply,
        replyTo: delegatedBy,
        hop,
        delegationId: delegatedId,
      });
      ledger.append(room.id, bot.id, "route", {
        targets: [delegatedBy],
        messageId: msg.id,
        hop,
        delegationId: delegatedId,
        turnId,
      });
      await run(room, delegator, msg, undefined, { hop, resultFor: delegatedId, workId: typeof state.parentWorkId === "string" ? state.parentWorkId : undefined, ...inherited });
    }
    if(consultationReply&&consultationReply.outcome!=='completed')return consultationReply.outcome;
    return status === "interrupted" ? "interrupted" : (signal.aborted||status==='cancelled') ? "cancelled" : status === "failed" ? "failed" : status === "incomplete" ? "incomplete" : "completed";
  }

  const getTurn = (id: string) => db.prepare("SELECT * FROM turns WHERE id = ?").get(id) as TurnRow | undefined;

  const approvalCallId = (approvalId: string): string | undefined => {
    const event = db.prepare("SELECT payload_json FROM events WHERE type='approval_requested' AND json_extract(payload_json,'$.approvalId')=? ORDER BY id DESC LIMIT 1").get(approvalId) as { payload_json: string } | undefined;
    const id = event ? JSON.parse(event.payload_json).toolCallId : undefined;
    return typeof id === "string" ? id : undefined;
  };

  /** An approval was decided for a turn that a restart interrupted: continue (or close) that turn. */
  async function resumeInterrupted(turn: TurnRow, approval: Approval, decision: Decision): Promise<void> {
    const room = getRoom(db, turn.room_id);
    const bot = getBot(db, turn.bot_id);
    const state = turn.state_json ? (JSON.parse(turn.state_json) as Record<string, unknown>) : {};
    const message = typeof state.messageId === "number" ? ledger.get(state.messageId) : undefined;
    if (!room || !bot || !message) {
      setTurn.run("failed", Date.now(), turn.id);
      ledger.append(turn.room_id, turn.bot_id, "error", { turnId: turn.id, message: "cannot resume: turn context missing" });
      return;
    }
    const original = (message.payload as { text?: string }).text ?? "";

    if (decision.kind === "ignore" || decision.kind === "respond") {
      const callId = approvalCallId(approval.id);
      if (callId) ledger.append(room.id, bot.id, "tool_result", { turnId: turn.id, toolCallId: callId, status: decision.kind === "ignore" ? "ignored" : "responded", ok: false, message: "The interrupted action was not authorized and did not run." });
    }
    if (decision.kind === "ignore") {
      setTurn.run("abandoned", Date.now(), turn.id);
      const linked = db.prepare("SELECT id FROM work_runs WHERE turn_id=?").get(turn.id) as { id: string } | undefined;
      if (linked) work.updateRun(linked.id, "failed", "The proposed action was ignored; it did not run.");
      ledger.append(room.id, bot.id, "turn_finished", { turnId: turn.id, status: "abandoned" });
      return;
    }
    let prompt: string;
    if (decision.kind === "respond") {
      prompt = `${decision.text}\n\n(Context: the service restarted while your earlier request was waiting for approval. The original request was: "${original}")`;
    } else {
      const args = decision.kind === "edit" ? decision.payload : approval.payload;
      const originalCall = approvalCallId(approval.id);
      state.pregrant = { approvalId:approval.id,toolName: approval.toolName, args, ...(typeof originalCall === "string" ? { toolCallId: originalCall } : {}) } satisfies Pregrant;
      prompt = `The service restarted while this request was waiting for approval, and the user has now approved ${approval.toolName}. Continue the original request: "${original}"`;
    }
    await run(room, bot, message, { turnId: turn.id, state, prompt });
  }

  ledger.subscribe("*", (event) => {
    if (shuttingDown || event.type !== "approval_decided") return;
    const { approvalId, decision } = event.payload as { approvalId: string; decision: Decision };
    const approval = deps.approvals.get(approvalId);
    const turn = approval?.turnId ? getTurn(approval.turnId) : undefined;
    if (!approval || !turn || turn.status !== "interrupted") return;
    if(turn.room_id.startsWith('_agent-request-'))return;
    const saved = turn.state_json ? JSON.parse(turn.state_json) as { workId?: string; agentRequestId?:string; agentRequestResult?:boolean } : {};
    if(saved.agentRequestId||saved.agentRequestResult)return;
    if (saved.workId && work.cancelled(saved.workId)) return;
    const p: Promise<void> = resumeInterrupted(turn, approval, decision)
      .catch((err) => {
        ledger.append(turn.room_id, turn.bot_id, "error", { turnId: turn.id, message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => resumedRuns.delete(p));
    resumedRuns.add(p);
  });

  return {
    agentRequests,
    async withIdleBot<T>(id: string, operation: () => Promise<T>): Promise<T> {
      const busy = configuring.has(id) || (admissions.get(id) ?? 0) > 0 ||
        !!db.prepare("SELECT 1 FROM work_runs r JOIN work w ON w.id=r.work_id WHERE w.bot_id=? AND r.status IN ('queued','running','draining') AND NOT(r.status='queued' AND r.turn_id IS NULL AND r.dispatch_claimed=0 AND r.message_id=w.request_id AND w.creation_key IS NOT NULL) LIMIT 1").get(id) ||
        !!db.prepare("SELECT 1 FROM approvals WHERE bot_id=? AND status='pending' LIMIT 1").get(id) ||
        !!db.prepare("SELECT 1 FROM action_receipts WHERE bot_id=? AND outcome='pending' LIMIT 1").get(id);
      if (busy) throw new ModelError("This bot has active or unresolved work. Finish active execution or pending action approvals in its conversation before changing models.", 409);
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      configuring.set(id, pending);
      try { return await operation(); } finally { configuring.delete(id); release(); }
    },
    work,
    cancelWork(id, revision) {
      const ids = ledger.atomic(() => {
        const previouslyRequested = work.get(id)?.cancelRequestedAt;
        const selected = new Set(work.requestCancel(id, revision));
        if (previouslyRequested === null) ledger.append("_system", "owner", "config", { action: "work_cancel_requested", workId: id });
        for (const approval of deps.approvals.listPending()) {
          if (!approval.turnId) continue;
          const r = db.prepare("SELECT work_id FROM work_runs WHERE turn_id=?").get(approval.turnId) as { work_id: string } | undefined;
          if (!r || !selected.has(r.work_id)) continue;
          const callId = approvalCallId(approval.id);
          // A stopped process awaiting approval never received permission to execute this call.
          if (callId && getTurn(approval.turnId)?.status === "interrupted") {
            ledger.append(approval.roomId, approval.botId, "tool_result", { turnId: approval.turnId, toolCallId: callId, status: "ignored", ok: false, message: "Cancelled before approval; the action did not run." });
            setTurn.run("cancelled", Date.now(), approval.turnId);
          }
          deps.approvals.expire(approval.id, "work cancellation requested");
        }
        questions.cancel(selected);
        return selected;
      });
      agentRequests.cancelWork(ids);
      for (const { workId, controller } of workControllers.values()) if (workId&&ids.has(workId)) controller.abort();
    },
    async runInvestigation(room,bot,message,execution){
      if(investigations.has(message.id))throw new Error('Investigation already admitted');
      investigations.set(message.id,Object.freeze(execution));
      try{await run(room,bot,message,undefined,{investigationId:execution.id,unattended:true,noIndex:true});}finally{investigations.delete(message.id);}
    },
    run,
    recover: () => {
      receipts.recover();
      agentRequests.recover();
      interruptConsultationWork();
      questions.recover();
      const n = markInterrupted("daemon restarted; turn interrupted (pending approvals stay pending)");
      work.recover();
      for(const queued of db.prepare('SELECT * FROM chat_dispatches WHERE turn_id IS NULL AND settled_at IS NULL').all() as {room_id:string;bot_id:string;message_id:number;context_json:string}[]){
        if(JSON.parse(queued.context_json).investigationId||JSON.parse(queued.context_json).agentRequestId||JSON.parse(queued.context_json).agentRequestResult){db.prepare('UPDATE chat_dispatches SET settled_at=? WHERE room_id=? AND bot_id=? AND message_id=?').run(Date.now(),queued.room_id,queued.bot_id,queued.message_id);continue;}
        const room=getRoom(db,queued.room_id),bot=getBot(db,queued.bot_id),message=ledger.get(queued.message_id);
        if(!room||!bot||!message)continue;
        const job=run(room,bot,message,undefined,JSON.parse(queued.context_json),true).catch(error=>{ledger.append(room.id,bot.id,'error',{message:String(error)});});
        resumedRuns.add(job);void job.finally(()=>resumedRuns.delete(job));
      }
      for(const q of questions.recover()) {
        const room=getRoom(db,q.roomId),bot=getBot(db,q.botId),message=q.messageId?ledger.get(q.messageId):undefined;
        if(!room||!bot||!message)continue;
        const delivery=questions.delivery(message.id,bot.id,room.id)!;
        const job=run(room,bot,message,undefined,{...delivery.meta,workId:q.workId??undefined}).catch(error=>ledger.append(room.id,bot.id,"error",{message:String(error)})).then(()=>{});
        resumedRuns.add(job);void job.finally(()=>resumedRuns.delete(job));
      }
      return n;
    },
    shutdown() {
      shuttingDown = true;
      agentRequests.interrupt();
      interruptConsultationWork();
      const n = markInterrupted("daemon shutting down; turn interrupted (pending approvals stay pending)");
      work.recover();
      for (const { controller } of workControllers.values()) controller.abort();
      return n;
    },
    async idle() {
      while (resumedRuns.size > 0 || background.size > 0) await Promise.all([...resumedRuns, ...background]);
    },
    async drain() {
      while (runs.size || resumedRuns.size || background.size) await Promise.allSettled([...runs, ...resumedRuns, ...background]);
    },
    activeTurn: (botId, roomId) => activeTurns.get(turnKey(botId, roomId)),
    async dispatch({ room, botIds, message }) {
      if (shuttingDown) throw new Error("Daemon is shutting down");
      await Promise.all(
        botIds.map(async (botId) => {
          const bot = getBot(db, botId);
          if (!bot) {
            ledger.append(room.id, "daemon", "error", { message: `unknown bot ${botId}` });
            return;
          }
          if(room.kind==='direct'&&!room.members.includes(bot.id)){await agentRequests.mention(room,message,bot.id);return;}
          const delivery=questions.delivery(message.id,bot.id,room.id);
          if(delivery && delivery.question.continuationState!=="queued")return;
          await run(room,bot,message,undefined,deliveryMeta(room,bot,message));
        }),
      );
    },
  };
}
