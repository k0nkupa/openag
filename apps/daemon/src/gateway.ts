import { resolveMessageReply, type MessageReply } from './message-replies.js';
import { forkConversation } from './conversation-forks.js';
import { isPrivateExecutionRoom } from './execution-rooms.js';
import { directTargets } from './addressing.js';
import { AgentRequestError, type AgentRequests } from './agent-requests.js';
import { publicRequestEvent, requestPage } from './request-provenance.js';
import { AUDIO_MAX_BYTES, TranscriptionError, transcriptionStatus, transcribe } from "./transcription.js";
import { createPermissions,PERMISSION_PRESETS, type Permissions } from './permissions.js';
import { createAvatarLibrary } from "./avatars.js";
import { InteractionError, type McpInteractions } from "./mcp/interactions.js";
import { createDeskBot, readBotCreation } from "./botcreation.js";
import {ResponsibilityError,type Responsibilities} from "./responsibilities.js";
import { ModelError, modelRevision, type BotModels } from "./botmodels.js";
import type { AppleAccess } from "./apple-access.js";
import type { ComposioConnect } from "./composio-connect.js";
import type { GoogleConnectors } from "./google-connectors.js";
import { setupReview } from "./integration-packages.js";
import { appLibrary, appListing } from "./app-library.js";
import { createQuestions, inputAnswer, QuestionError } from "./questions.js";
import {automationRunQuery} from "./automation-runs.js";
import { ApprovalError } from "./approvals.js";
import { createResults, ResultError, resultPage, resultQuery,readableResultIdsSQL } from "./results.js";
import { createUploads, attachmentIds, UploadError, UPLOAD_FILE_MAX } from "./uploads.js";
import { z } from "zod";
import { WorkError, workStatuses, type Work } from "./work.js";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { WebSocket, WebSocketServer } from "ws";
import { type Auth, createRateLimiter, isDeviceAccess, type Principal, TOO_MANY_PAIRING_CODES, tokenMatches } from "./auth.js";
import { getDefaultBotId } from "./defaultbot.js";
import { createDeskRoom, readRoomCreation, RoomCreationError } from "./roomcreation.js";
import { createIngress } from "./ingress.js";
import type { SlackChannel } from "./slack.js";
import type { Backups } from "./backup.js";
import type { Ops } from "./ops.js";
import type { ReadinessService } from "./readiness.js";
import { newRtcTopic, type RtcService } from "./rtc.js";
import { isRouterStrategy, type RoomRouter } from "./router.js";
import type { Approvals, Decision } from "./approvals.js";
import type { Db } from "./db/index.js";
import type { Ledger, LedgerEvent } from "./ledger.js";
import { createStaticHandler } from "./static.js";
import { type Bot, addMember, getBot, getRoom, listBots, listRooms, type Room, updateBot } from "./rooms.js";
import { type Avatar, BotSettingsError, needsOwner, parseAvatar, parseBotSettings } from "./botsettings.js";
import { getSetting, isSettingKey, listSettings, resolveTimezone, SettingsError, setSetting, type Push, type Rtc } from "./settings.js";
import { listWakeDecisions, setWakeFeedback } from "./wake.js";
import { deliverBrief } from "./brief.js";
import type { Reflection } from "./reflection.js";
import { AutomationError, type Automation, type AutomationManager } from "./automations.js";
import type { HookHandler } from "./hooks.js";
import { newPushTopic, type Pusher } from "./push.js";
import { getDefaultRedactor } from "./redact.js";
import type { McpManager } from "./mcp.js";
import { checkCandidateSchema, type McpServerCheck } from "./mcp-check.js";
import { commandProposalSchema, type McpCommandReview } from "./mcp-command-review.js";
import { McpOAuthError, type McpOAuth } from "./mcp-oauth.js";
import { McpServerError, addServerSchema, removeServerSchema, updateServerSchema, type McpServerChange, type McpServerService } from "./mcp-servers.js";
import type { McpAccess } from "./mcpserver.js";
import { VIEW_BODY_BYTES, VIEW_PREFIX, viewCookie, type ViewProxy } from "./computerview.js";
import { TakeoverError, type Takeover } from "./takeover.js";
import { AppsError, type AppsManager } from "./apps.js";
import { ComputerError, NOT_RUNNING_MESSAGE, type Computer } from "./computer.js";
import type { ComputerRouter } from "./computer/router.js";
import { createSkillCatalogue, SkillError, type SkillCatalogue } from "./skills.js";
import { modelsStatus } from "./models.js";
import { MEMORY_MAX_BYTES, readMemoryFull, writeMemoryFull } from "./memory.js";
import { commitMemory } from "./datagit.js";
import type { VectorMemory } from "./vectors.js";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export interface DispatchArgs {
  room: Room;
  botIds: string[];
  message: LedgerEvent;
}

export interface GatewayDeps {
  agentRequests?: AgentRequests;
  permissions?: Permissions;
  skills?: SkillCatalogue;
  skillsChanged?: () => Promise<void>;
  mcpInteractions?: McpInteractions;
  google?: GoogleConnectors;
  composio?: ComposioConnect;
  apple?: AppleAccess;
  botModels?: BotModels;
  modelEnv?: NodeJS.ProcessEnv;
  transcriptionFetch?: typeof fetch;
  work?: Work;
  cancelWork?: (id: string, revision?: number) => void;
  db: Db;
  ledger: Ledger;
  approvals: Approvals;
  auth: Auth;
  dispatch: (args: DispatchArgs) => void | Promise<void>;
  deskDir?: string;
  /** Clock for the pairing-failure audit throttle; injectable for tests. */
  now?: () => number;
  /** IANA zone for the morning brief. Defaults to resolveTimezone(). */
  tz?: string;
  /** Scheduled automations. Without it, the /automations routes are not registered. */
  automations?: AutomationManager;
  responsibilities?:Responsibilities;
  /** Public ingress for POST /hooks/:slug (unauthenticated; verification lives in the handler). */
  hooks?: HookHandler;
  /** Nightly reflection. Without it, the /reflection routes are not registered. */
  reflection?: Reflection;
  /** ntfy pusher. Without it, the /push routes are not registered. */
  push?: Pusher;
  /** MCP status and reload. Without it, /mcp answers with no servers. Config changes go through `mcpServers` (owner only), never through this. */
  mcp?: McpManager;
  /** Owner write path for custom MCP servers (POST/PATCH/DELETE /mcp/servers). Without it those routes answer 503. */
  mcpServers?: McpServerService;
  /** Owner-proposed, approval-gated server checks (POST/GET /mcp/servers/check). Without it those routes answer 503. */
  mcpCheck?: McpServerCheck;
  /** Command reviews for local command servers written from the desk (OA-456). Without it those routes answer 503. */
  mcpCommandReview?: McpCommandReview;
  /** OAuth sign-in for custom remote servers (OA-457). Without it those routes answer 503. */
  mcpOAuth?: McpOAuth;
  /** Sandbox computer. Without it, the /computer routes are not registered. */
  computer?: Computer;
  /** Data dir the computer writes screenshots under (screenshot paths are relative to it). */
  dataDir?: string;
  /** Vector memory for GET /memory/search. Without it search answers 503. */
  vectors?: VectorMemory;
  /** Bot-facing MCP endpoint (POST /mcp). Without it, /mcp is not served. Its auth is the scoped token, not the owner's. */
  mcpAccess?: McpAccess;
  /** Room router for messages without an @mention (router.ts). Without it every room uses its lead. */
  router?: RoomRouter;
  slack?: Pick<SlackChannel, "reload" | "status">;
  rtc?: Pick<RtcService, "reload" | "status" | "createInvite">;
  backups?: Backups;
  ops?: Pick<Ops, "status">;
  readiness?: ReadinessService;
  /** Owner-installed Apps (apps.ts). Without it, /apps is not served. */
  apps?: AppsManager;
  /** Human takeover of the computer. Needs `computer`. Without it, /computer/takeover and /computer/view are not served. */
  takeover?: Takeover;
  /** The /computer/view/* proxy (cookie auth, not Bearer). Needs `takeover`. */
  viewProxy?: ViewProxy;
}

type AppEnv = { Variables: { principal: Principal; rawPrincipal: Principal } };

export { tokenMatches };

const PAIR_MAX_ATTEMPTS = 5;
const PAIR_WINDOW_MS = 60_000;
const PAIR_FAILED_AUDIT_INTERVAL_MS = 60_000;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MAX_FORWARDED_KEY_LENGTH = 64;
const REVOKE_CLOSE_CODE = 4001;
const REVOKE_TERMINATE_MS = 1000;
const PAIR_GLOBAL_MAX_ATTEMPTS = 30;
const PAIR_MAX_BODY_BYTES = 4 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
// JSON escaping can expand a bounded 256 KiB saved result sixfold.
const MCP_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Rate-limit key for /pair. X-Forwarded-For is trusted only when the TCP peer is loopback, which is how
 * Tailscale Serve reaches the daemon; from any other peer the header is attacker-controlled and ignored.
 */
export function clientKey(remoteAddress: string | undefined, forwardedFor: string | undefined): string {
  if (!remoteAddress) return "unknown";
  if (!LOOPBACK.has(remoteAddress)) return remoteAddress;
  // The LAST entry is the one the loopback proxy itself appended (the real peer); earlier entries are client-supplied.
  const last = forwardedFor?.split(",").at(-1)?.trim().slice(0, MAX_FORWARDED_KEY_LENGTH);
  return last ? last : remoteAddress;
}

function remoteAddressOf(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined; // no socket behind app.request() in tests
  }
}

// apps/desk/dist, resolved relative to this file so it works from both src/ (tests) and dist/.
export const DESK_DIR =
  process.env.OPENAG_DESK_DIR ?? fileURLToPath(new URL("../../desk/dist", import.meta.url));

export interface BotInfo {
  id: string;
  name: string;
  runtime: string;
  model: string | null;
  modelRevision?: string;
  description?: string;
  adapter?: string;
  canDelegate?: boolean;
  avatar?: Avatar;
  /** The bot unattended features use when none is chosen (setting defaultBot). */
  isDefault?: boolean;
}

/** Only whitelisted, typed fields of bot.config are exposed; instructions and the raw config never leave the daemon. */
export function toBotInfo(bot: Bot, env = process.env, defaultBotId: string | null = null): BotInfo {
  const config = (bot.config ?? {}) as Record<string, unknown>;
  const info: BotInfo = { id: bot.id, name: bot.name, runtime: bot.runtime, model: bot.model, modelRevision: modelRevision(bot, env) };
  if (typeof config.description === "string") info.description = config.description;
  if (typeof config.adapter === "string") info.adapter = config.adapter;
  if (typeof config.canDelegate === "boolean") info.canDelegate = config.canDelegate;
  const avatar = parseAvatar(config.avatar);
  if (avatar) info.avatar = avatar;
  if (bot.id === defaultBotId) info.isDefault = true;
  return info;
}

/** The push topic is a credential: the audit trail records only that it is set. */
const auditSetting = (key: string, value: unknown): unknown => {
  if (key === "profile") return { fields: ["name", "avatar"] };
  if (key === "skillLibrary") return { enabled: (value as { enabled: boolean }).enabled };
  if ((key !== "push" && key !== "rtc") || typeof value !== "object" || value === null) return value;
  return { ...(value as Push), topic: (value as Push).topic ? "(set)" : null };
};

const NOT_CONFIGURED_MSG = "push is not enabled or has no topic";

/** A hand-written entry can carry user:password in its URL (it is then invalid); the desk never shows it. Saving the edit writes the URL without it. */
function hideUrlCredentials<T extends { url?: string }>(server: T): T {
  if (!server.url) return server;
  try {
    const url = new URL(server.url);
    if (!url.username && !url.password) return server;
    url.username = ""; url.password = "";
    return { ...server, url: url.href };
  } catch { return server; }
}

function mcpBody(mcp: McpManager | undefined, owner = false) {
  const body = { servers: mcp?.status() ?? [], configPath: mcp?.configPath ?? null };
  if (!owner || !mcp) return body;
  // Editable detail (URL, header templates, digest) is for the owner only; an unsafe or unreadable file is reported, never half-shown.
  try { const entries = mcp.entries(); return { ...body, entries: { ...entries, servers: entries.servers.map(hideUrlCredentials) } }; }
  catch { return { ...body, entries: null, entriesError: "mcp.json cannot be read safely; fix it on the machine first" }; }
}

export function createGateway(deps: GatewayDeps): Hono<AppEnv> {
  const skills = deps.skills ?? (deps.dataDir ? createSkillCatalogue(deps.db, deps.dataDir) : undefined);
  const { db, ledger, approvals, auth } = deps;
  const avatarLibrary = createAvatarLibrary(db, ledger);
  const ingress = createIngress({ ledger, dispatch: deps.dispatch, router: deps.router });
  const originatingRoom=(roomId:string)=>(db.prepare('SELECT origin_room_id FROM agent_requests WHERE execution_room_id=?').get(roomId) as {origin_room_id:string}|undefined)?.origin_room_id??roomId;
  const approvalView=(approval:import('./approvals.js').Approval)=>({...approval,roomId:originatingRoom(approval.roomId)});
  const receiptView=(receipt:import('./action-receipts.js').ActionReceipt)=>{const originRoomId=originatingRoom(receipt.roomId);return originRoomId===receipt.roomId?receipt:{...receipt,originRoomId};};
  const questions=createQuestions(db,ledger);
  const app = new Hono<AppEnv>();
  const now = deps.now ?? Date.now;
  const tz = deps.tz ?? resolveTimezone();
  const pairLimiter = createRateLimiter({ max: PAIR_MAX_ATTEMPTS, windowMs: PAIR_WINDOW_MS });
  // Backstop across all clients: a local process behind the loopback proxy can vary X-Forwarded-For freely, so the
  // per-client key alone would not bound guessing.
  const pairGlobalLimiter = createRateLimiter({ max: PAIR_GLOBAL_MAX_ATTEMPTS, windowMs: PAIR_WINDOW_MS });
  let lastPairFailAudit = Number.NEGATIVE_INFINITY;

  // Unauthenticated liveness probe (also used by the e2e script and the launchd service); reveals nothing sensitive.
  app.get("/health", (c) => {
    const row = db.prepare("SELECT vec_version() AS v").get() as { v: string };
    return c.json({ ok: true, vec_version: row.v });
  });

  // Unauthenticated by design (GitHub, Slack, scripts): verification happens inside the handler, which also caps the body.
  if (deps.hooks) {
    const hooks = deps.hooks;
    app.post("/hooks/:slug", (c) =>
      hooks.handle(c.req.raw, c.req.param("slug"), clientKey(remoteAddressOf(c), c.req.header("x-forwarded-for"))),
    );
  }

  const callbackLimiter = createRateLimiter({ max: 20, windowMs: 60000 });
  const callbackGlobalLimiter = createRateLimiter({ max: 100, windowMs: 60000 });
  const canCompleteSignIn = (actor: string) => actor === "owner" || auth.listDevices().some(device => device.id === actor && device.revokedAt === null && device.access === "full");
  // The single-use pending attempt supplies authority, never a browser cookie or Host header.
  app.get("/composio-connect", async c => {
    c.header("Cache-Control", "no-store"); c.header("Referrer-Policy", "no-referrer");
    const client = clientKey(remoteAddressOf(c), c.req.header("x-forwarded-for"));
    let params: URLSearchParams | undefined;
    try { if (c.req.url.length <= 8192) params = new URL(c.req.url).searchParams; } catch { /* malformed callback */ }
    const oauthState = params?.getAll("state").length === 1 && !!deps.mcpOAuth?.hasPendingState(params.get("state")!);
    const knownAttempt = oauthState || (params?.getAll("state").length === 1 && deps.composio?.hasPendingState(params.get("state")!));
    // Unknown probes cannot spend a legitimate pending attempt's ability to finish.
    if (!knownAttempt && (!callbackLimiter.check(client).ok || !callbackGlobalLimiter.check("global").ok)) return c.text("Too many failed sign-in callbacks. Return to your desk and try again later.", 429);
    try {
      if (!params || !(deps.composio || oauthState)) throw Error();
      const input: Record<string, string> = {};
      for (const key of ["state", "code", "error", "iss"]) {
        const values = params.getAll(key);
        if (values.length > 1) throw Error();
        if (values.length) input[key] = values[0]!;
      }
      // A custom server's sign-in shares this callback path; the exact single-use state says whose it is.
      if (oauthState) {
        await deps.mcpOAuth!.callback(input, canCompleteSignIn);
        c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        return c.html("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Return to OpenAg</title><p>Sign-in finished. You can close this tab and return to OpenAg.</p></html>");
      }
      if (!deps.composio) throw Error();
      const managed = deps.composio.isManagedState(input.state ?? "");
      const destination = await deps.composio.callback(input, canCompleteSignIn);
      if (managed) { c.header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"); return c.html("<!doctype html><html lang=\"en\"><title>Return to OpenAg</title><script>history.replaceState(null,'','/');window.close()</script><h1>Return to OpenAg</h1><p>OpenAg received the sign-in response. You can close this tab.</p></html>"); }
      return c.redirect(destination, 303);
    } catch {
      callbackLimiter.record(client); callbackGlobalLimiter.record("global");
      if (oauthState) return c.text("Sign-in was not completed or has expired. Return to OpenAg and try again.", 400);
      return c.text("Composio sign-in was not completed or has expired. Return to your original desk and start again.", 400);
    }
  });

  // The desk SPA is static, with no data in it; every API call it makes still needs the token.
  app.use("*", createStaticHandler(deps.deskDir ?? DESK_DIR));

  // Unauthenticated by design: a device has no token yet. Registered before the auth middleware.
  // Unauthenticated, so the body is capped before it is parsed (an anonymous multi-GB body would exhaust memory).
  app.post("/pair", bodyLimit({ maxSize: PAIR_MAX_BODY_BYTES, onError: (c) => c.json({ error: "payload too large" }, 413) }), async (c) => {
    // Only FAILED redemptions are charged, so someone else's guesses can never lock a correct code out; a client
    // that already used up its own budget is refused without touching the shared one.
    const clientId = clientKey(remoteAddressOf(c), c.req.header("x-forwarded-for"));
    const limit = pairLimiter.check(clientId);
    const globalLimit = pairGlobalLimiter.check("global");
    if (!limit.ok || !globalLimit.ok) {
      const retry = Math.max(limit.retryAfterSec, globalLimit.retryAfterSec);
      c.header("Retry-After", String(retry));
      return c.json({ error: "too many attempts" }, 429);
    }
    const body = (await c.req.json().catch(() => null)) as { code?: unknown; name?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    const name = typeof body?.name === "string" ? body.name : "";
    const result = code === "" ? null : auth.redeemPairingCode(code, name);
    if (!result) {
      pairLimiter.record(clientId);
      pairGlobalLimiter.record("global");
      // Throttled to one audit line per minute so an attacker cannot flood the ledger.
      if (now() - lastPairFailAudit >= PAIR_FAILED_AUDIT_INTERVAL_MS) {
        lastPairFailAudit = now();
        ledger.append("_system", "user", "config", { action: "pairing_failed" });
      }
      return c.json({ error: "invalid or expired code" }, 400);
    }
    ledger.append("_system", "user", "config", {
      action: "pairing_redeemed",
      deviceId: result.device.id,
      name: result.device.name,
      by: result.createdBy,
    });
    return c.json({ deviceId: result.device.id, token: result.token }, 200);
  });

  // Bot-facing MCP endpoint: registered before the owner/device auth, because its only credential is the scoped token.
  // Exact path only, so /mcp/servers and /mcp/reload keep the normal auth.
  if (deps.mcpAccess) {
    const access = deps.mcpAccess;
    app.all(
      "/mcp",
      bodyLimit({ maxSize: MCP_BODY_BYTES, onError: (c) => c.json({ error: "payload too large" }, 413) }),
      (c) => access.handle(c.req.raw),
    );
  }

  if (deps.viewProxy) {
    // Cookie-authenticated (checked inside the proxy), so it sits before the Bearer middleware.
    const proxy = deps.viewProxy;
    app.all(
      "/computer/view/*",
      bodyLimit({ maxSize: VIEW_BODY_BYTES, onError: (c) => c.json({ error: "payload too large" }, 413) }),
      (c) => proxy.handle(c.req.raw),
    );
  }

  app.use("*", (c, next) => c.req.method === "POST" && /^\/rooms\/[^/]+\/(?:uploads|dictation)$/.test(c.req.path) ? next() : bodyLimit({ maxSize: MAX_BODY_BYTES, onError: c => c.json({ error: "payload too large" }, 413) })(c, next));

  app.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const raw = auth.authenticate(bearer);
    if (!raw) return c.json({ error: "unauthorized" }, 401);
    c.set("rawPrincipal", raw);
    // A device with full access is the owner (a flag kept by the daemon; the owner token itself is never copied).
    c.set("principal", raw.kind === "device" && raw.access === "full" ? { kind: "owner" } : raw);
    await next();
  });

  // Execution rooms are daemon-private. Inspection uses the current-scope responsibility/result projections.
  app.use('*',async(c,next)=>{
    if(c.req.path.startsWith('/rooms/')){let id:string;try{id=decodeURIComponent(c.req.path.split('/')[2]??'');}catch{return c.json({error:'room not found'},404);}if(isPrivateExecutionRoom(id))return c.json({error:'room not found'},404);}
    await next();
  });

  const actorOf = (p: Principal): string => (p.kind === "owner" ? "owner" : p.deviceId);

  app.get("/whoami", (c) => {
    const p = c.get("rawPrincipal");
    if (p.kind === "owner") return c.json({ kind: "owner" });
    return c.json({ kind: "device", deviceId: p.deviceId, name: p.name, access: p.access });
  });

  app.post("/devices", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; access?: unknown } | null;
    const access = isDeviceAccess(body?.access) ? body.access : "limited";
    const { device, token } = auth.createDevice(typeof body?.name === "string" ? body.name : "", "owner", access);
    ledger.append("_system", "user", "config", {
      action: "device_created",
      deviceId: device.id,
      name: device.name,
      access,
      by: "owner",
    });
    return c.json({ device, token }, 201);
  });

  app.get("/devices", (c) => {
    const p = c.get("rawPrincipal");
    const devices = auth.listDevices().map((d) => ({
      ...d,
      current: p.kind === "device" && p.deviceId === d.id,
    }));
    return c.json({ devices });
  });

  app.post("/devices/pairing-codes", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { access?: unknown } | null;
    const access = isDeviceAccess(body?.access) ? body.access : "limited";
    // Only the owner (or a full-access device) can hand out full access.
    if (access === "full" && c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    try {
      const { code, expiresAt } = auth.createPairingCode(actorOf(c.get("principal")), access);
      ledger.append("_system", "user", "config", {
        action: "pairing_code_created",
        by: actorOf(c.get("principal")),
        access,
      });
      return c.json({ code, expiresAt }, 201);
    } catch (err) {
      if (err instanceof Error && err.message === TOO_MANY_PAIRING_CODES) {
        return c.json({ error: TOO_MANY_PAIRING_CODES }, 429);
      }
      throw err;
    }
  });

  app.patch("/devices/:id", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const body = (await c.req.json().catch(() => null)) as { access?: unknown } | null;
    if (!isDeviceAccess(body?.access)) return c.json({ error: "access must be limited|full" }, 400);
    const id = c.req.param("id");
    if (!auth.setDeviceAccess(id, body.access)) return c.json({ error: "device not found" }, 404);
    if (body.access === "limited") deps.composio?.revokeDevice(id);
    ledger.append("_system", "user", "config", { action: "device_access_changed", deviceId: id, access: body.access, by: actorOf(c.get("principal")) });
    return c.json({ id, access: body.access });
  });

  app.delete("/devices/:id", (c) => {
    const id = c.req.param("id");
    const cascade = c.req.query("cascade") === "1";
    const revoked = auth.revokeDeviceTree(id, cascade);
    if (revoked.length === 0) return c.json({ error: "device not found" }, 404);
    for (const deviceId of revoked) {
      ledger.append("_system", "user", "config", {
        action: "device_revoked",
        deviceId,
        by: actorOf(c.get("principal")),
        ...(deviceId !== id ? { cascadeFrom: id } : {}),
      });
    }
    return c.body(null, 204);
  });

  const roomView = (room: Room) => ({
    id: room.id,
    name: room.name,
    leadBotId: room.leadBotId,
    description: room.description ?? "",
    members: room.members,
    kind: room.kind,
    router: room.router ?? "lead",
    routerConfig: getDefaultRedactor().redact(deps.router?.configuration(room) ?? room.routerConfig ?? null),
    routerRevision: deps.router?.revision(room),
  });

  // Rooms whose id starts with "_" are internal (e.g. the heartbeat room) and are never listed.
  const workPage = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
  const workQuery = workPage.extend({ roomId: z.string().min(1).max(64).optional(), botId: z.string().min(1).max(64).optional(), parentId: z.string().uuid().optional(), q: z.string().trim().min(1).max(300).optional(), status: z.enum(workStatuses).optional() }).strict();
  const results = createResults(db, ledger,{canReadInvestigation:id=>deps.responsibilities?.canRead(id)??false,readableScopes:()=>deps.responsibilities?.readableScopes()??[]});
  app.get('/responsibilities',c=>{c.header('cache-control','no-store');return c.json({responsibilities:deps.responsibilities?.list()??[],source:deps.responsibilities?.readiness()??{state:'source_unavailable',bindingId:null,resourceIds:[]}});});
  app.get('/responsibilities/:id/history',c=>{c.header('cache-control','no-store');return c.json({investigations:deps.responsibilities?.history(c.req.param('id'))??[]});});
  for(const method of ['POST','PUT'] as const)app.on(method,method==='POST'?'/responsibilities':'/responsibilities/:id',async c=>{
    if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
    if(!deps.responsibilities)return c.json({error:'Responsibilities unavailable'},503);
    try{const body=await c.req.json();const item=method==='POST'?deps.responsibilities.create(body):deps.responsibilities.update(c.req.param('id')!,body);ledger.append('_system','user','config',{action:method==='POST'?'responsibility_created':'responsibility_updated',responsibilityId:item.id,revision:item.revision,by:actorOf(c.get('principal'))});return c.json({responsibility:item},method==='POST'?201:200);}
    catch(error){return c.json({error:error instanceof ResponsibilityError?error.message:'Invalid responsibility configuration'},error instanceof ResponsibilityError?error.status:400);}
  });
  app.get("/results", c => {
    c.header("cache-control", "no-store");
    const parsed = resultQuery.safeParse(c.req.query());
    return parsed.success ? c.json(results.list(parsed.data)) : c.json({error:"invalid result query"},400);
  });
  app.get("/results/:id/versions", c => {
    c.header("cache-control", "no-store");
    const parsed = resultPage.safeParse(c.req.query()); if(!parsed.success)return c.json({error:"invalid page"},400);
    try { return c.json(results.versions(c.req.param("id"),parsed.data.before,parsed.data.limit)); }
    catch(error){if(error instanceof ResultError)return c.json({error:error.message},error.status as 400|403|404|409|503);throw error;}
  });
  for(const suffix of ["", "/download"]) app.get(`/results/:id${suffix}`, c => {
    c.header("cache-control", "no-store");
    const parsed=z.object({version:z.coerce.number().int().positive().optional()}).strict().safeParse(c.req.query());if(!parsed.success)return c.json({error:"invalid result version"},400);
    try {
      const result=results.get(c.req.param("id"),parsed.data.version);
      return suffix ? c.body(result.content,200,{"content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff","content-disposition":"attachment","cache-control":"no-store"}) : c.json(result);
    }catch(error){if(error instanceof ResultError)return c.json({error:error.message},error.status as 400|403|404|409|503);throw error;}
  });

  app.get("/rooms/:id/requests",c=>{
    c.header('cache-control','no-store');
    const room=getRoom(db,c.req.param('id'));if(!room||isPrivateExecutionRoom(room.id))return c.json({error:'room not found'},404);
    const parsed=z.object({before:z.string().max(300).optional()}).strict().safeParse(c.req.query());if(!parsed.success)return c.json({error:'invalid requests page'},400);
    let cursor:{at:number;id:string}|undefined;
    try{if(parsed.data.before)cursor=z.object({at:z.number().int().nonnegative(),id:z.string().max(100)}).strict().parse(JSON.parse(Buffer.from(parsed.data.before,'base64url').toString('utf8')));}catch{return c.json({error:'invalid requests page'},400);}
    const rows=db.prepare(`WITH pending AS (
      SELECT 'question' kind,id,created_at at FROM work_questions WHERE room_id=? AND status='open'
      UNION ALL SELECT 'provider',a.id,a.created_at FROM mcp_interactions a WHERE a.status='open' AND coalesce((SELECT origin_room_id FROM agent_requests WHERE execution_room_id=a.room_id),a.room_id)=?
    ) SELECT * FROM pending WHERE (? IS NULL OR at<? OR (at=? AND id<?)) ORDER BY at DESC,id DESC LIMIT 31`).all(room.id,room.id,cursor?.at??null,cursor?.at??null,cursor?.at??null,cursor?.id??null) as {kind:'question'|'provider';id:string;at:number}[];
    const last=rows[29];return c.json({requests:rows.slice(0,30).map(r=>({...r,...(r.kind==='question'?{question:questions.get(r.id)}:{})})),nextCursor:rows.length>30?Buffer.from(JSON.stringify({at:last.at,id:last.id})).toString('base64url'):null});
  });
  app.get("/mcp/interactions/:id",c=>{
    c.header("cache-control","no-store");
    if(c.get("principal").kind!=="owner")return c.json({error:"owner token required"},403);
    const interaction=deps.mcpInteractions?.get(c.req.param("id"));
    return interaction?c.json({interaction:{...interaction,roomId:originatingRoom(interaction.roomId)}}):c.json({error:"Interaction not found"},404);
  });
  app.post("/mcp/interactions/:id/response",async c=>{
    if(c.get("principal").kind!=="owner")return c.json({error:"owner token required"},403);
    const parsed=z.object({revision:z.string().uuid(),action:z.enum(['accept','decline','cancel']),content:z.record(z.string(),z.unknown()).optional()}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)return c.json({error:"Invalid interaction response"},400);
    if(!deps.mcpInteractions)return c.json({error:"Interactions unavailable"},503);
    try{const interaction=deps.mcpInteractions.respond(c.req.param("id"),parsed.data.revision,parsed.data.action,parsed.data.content);return c.json({interaction:{...interaction,roomId:originatingRoom(interaction.roomId)}});}
    catch(error){if(error instanceof InteractionError)return c.json({error:error.message},error.status as 400|403|404|409|503);throw error;}
  });
  app.get("/questions/:id",c=>{
    c.header("cache-control","no-store");
    const question=questions.get(c.req.param("id"));
    return question?c.json({question}):c.json({error:"question not found"},404);
  });
  async function postQuestionAnswer(id:string,revision:number,answer:string,roomId?:string,attachments:unknown=[]){
    const q=questions.get(id);if(!q||(roomId&&q.roomId!==roomId))throw new QuestionError('question not found',404);
    const parsed=attachmentIds.safeParse(attachments);if(!parsed.success)throw new UploadError('invalid attachments');
    if(q.status==='answered'){
      const recorded=q.messageId?ledger.get(q.messageId):undefined;
      const previous=(recorded?.payload as {attachments?:{id:string}[]}|undefined)?.attachments??[];
      if(q.answer===getDefaultRedactor().redactString(answer)&&JSON.stringify(previous.map(file=>file.id))===JSON.stringify(parsed.data))return {question:q,duplicate:true};
      throw new QuestionError('This input request changed or was closed. Review its current state.');
    }
    const files=parsed.data.length?uploads?.prepare(q.roomId,parsed.data):[];if(!files)throw new UploadError('uploads unavailable');
    if(!deps.work)throw new QuestionError('work unavailable',503);
    const room=getRoom(db,q.roomId),work=q.workId?deps.work.get(q.workId):undefined;
    if(!room||(q.workId&&!work))throw new QuestionError('Original work or room unavailable');
    const posted=await ingress.post(room,answer,{botIds:[q.botId],extra:{questionId:id,workId:q.workId,...(files.length?{attachments:files}:{})},onMessage:message=>{
      const result=questions.answer(id,revision,answer,message.id);if(result.duplicate)throw new QuestionError('Answer already recorded.');
      if(q.workId)deps.work!.begin({roomId:q.roomId,botId:q.botId,messageId:message.id,workId:q.workId});
      if(files.length)uploads!.bind(room.id,files.map(f=>f.id),message.id);
    }});
    return {question:questions.get(id),messageId:posted.message.id};
  }
  app.post("/questions/:id/answer",async c=>{
    if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
    const parsed=inputAnswer.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:'A response of 1–8000 characters and the current revision are required.'},400);
    try{const result=await postQuestionAnswer(c.req.param('id'),parsed.data.revision,parsed.data.answer);return c.json(result,result.duplicate?200:202);}
    catch(error){if(error instanceof QuestionError||error instanceof WorkError)return c.json({error:error.message},error.status as 400|404|409|503);throw error;}
  });


  app.get("/work", c => {
    if (!deps.work) return c.json({ error: "work unavailable" }, 503);
    const parsed = workQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid work query" }, 400);
    return c.json(deps.work.list(parsed.data));
  });
  app.get("/work/:id", c => {
    if (!deps.work) return c.json({ error: "work unavailable" }, 503);
    const item = deps.work.get(c.req.param("id"));
    return item ? c.json({ work: item }) : c.json({ error: "work not found" }, 404);
  });
  for (const kind of ["runs", "approvals", "activity"] as const) app.get(`/work/:id/${kind}`, c => {
    if (!deps.work) return c.json({ error: "work unavailable" }, 503);
    const parsed = (kind === "activity" ? workPage.extend({after:z.coerce.number().int().positive().optional()}).refine(p=>p.before===undefined||p.after===undefined) : workPage).safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid page" }, 400);
    try { return c.json(kind === "activity" ? deps.work.activity(c.req.param("id"), parsed.data.before, parsed.data.limit, "after" in parsed.data ? parsed.data.after as number | undefined : undefined) : kind === "runs" ? deps.work.links(c.req.param("id"), parsed.data.before, parsed.data.limit) : deps.work.approvals(c.req.param("id"), parsed.data.before, parsed.data.limit)); }
    catch (error) { if (error instanceof WorkError) return c.json({ error: error.message }, error.status as 400 | 404); throw error; }
  });
  app.post("/work/:id/start",async c=>{
    if(c.get("principal").kind!=="owner")return c.json({error:"owner token required"},403);
    if(!deps.work)return c.json({error:"work unavailable"},503);
    const input=z.object({revision:z.number().int().positive()}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!input.success)return c.json({error:"Current Work revision required"},400);
    const item=deps.work.get(c.req.param('id'));
    if(!item||!item.explicit)return c.json({error:"Explicit Work not found"},404);
    if(!deps.work.ready(item.id))return c.json({work:item,alreadyStarted:true});
    if(item.revision!==input.data.revision)return c.json({error:"Work changed. Review it again."},409);
    const room=getRoom(db,item.roomId),message=ledger.get(item.requestId);
    if(!room||!message||!room.members.includes(item.botId))return c.json({error:"Original conversation or assignee unavailable"},409);
    ledger.append('_system','user','config',{action:'work_started',workId:item.id});
    void Promise.resolve(deps.dispatch({room,botIds:[item.botId],message})).catch(error=>ledger.append(room.id,'daemon','error',{message:String(error)}));
    return c.json({work:deps.work.get(item.id)},202);
  });
  app.post("/work/:id/cancel", async c => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.work || !deps.cancelWork) return c.json({ error: "cancellation unavailable" }, 503);
    const raw = await c.req.text();
    let body: unknown = {};
    try { if (raw) body = JSON.parse(raw); } catch { return c.json({ error: "invalid JSON" }, 400); }
    const parsed = z.object({ revision: z.number().int().positive().optional() }).strict().safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid cancellation" }, 400);
    try {
      deps.cancelWork(c.req.param("id"), parsed.data.revision);
      const item = deps.work.get(c.req.param("id"))!;
      return c.json({ work: item }, item.status === "cancelled" ? 200 : 202);
    } catch (error) { if (error instanceof WorkError) return c.json({ error: error.message }, error.status as 400 | 404 | 409); throw error; }
  });

  app.get("/rooms", (c) => c.json({ rooms: listRooms(db).filter((r) => !r.id.startsWith("_")).map(roomView) }));

  app.get("/rooms/creation/requests/:requestId", c => {
    c.header("cache-control", "no-store");
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    try {
      const room = readRoomCreation(db, c.req.param("requestId"));
      return c.json({ room: room ? roomView(room) : null });
    } catch (error) { if (error instanceof RoomCreationError) return c.json({ error: error.message }, error.status as 400|403|404|409|503); throw error; }
  });

  app.post("/rooms", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    try {
      const result = createDeskRoom(db, ledger, await c.req.json().catch(() => null));
      return c.json({ room: roomView(result.room), created: result.created }, result.created ? 201 : 200);
    } catch (err) {
      if (err instanceof RoomCreationError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  app.post('/rooms/:id/fork', async c => {
    if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
    try {
      const result=forkConversation(db,ledger,c.req.param('id'),await c.req.json().catch(()=>null));
      return c.json({room:roomView(result.room),created:result.created},result.created?201:200);
    } catch(error) {if(error instanceof RoomCreationError)return c.json({error:error.message},error.status as 400|403|404|409|503);throw error;}
  });

  // Which routing strategies are usable (and why not): never a secret.
  app.get("/readiness", (c) => (deps.readiness ? c.json(deps.readiness.check()) : c.json({ ready: false, items: [] })));

  // Flips only the safe defaults (heartbeat, reflection, brief); never push, Slack, WebRTC or anything with a secret.
  app.post("/readiness/apply", (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.readiness) return c.json({ error: "not available" }, 409);
    return c.json(deps.readiness.apply());
  });

  app.get("/ops", (c) => c.json(deps.ops?.status() ?? { startedAt: 0, healthcheck: { configured: false, lastOkAt: null, lastError: null }, logs: { lastRotatedAt: null, rotated: 0 } }));

  app.get("/backups", (c) => c.json(deps.backups?.status() ?? { enabled: false, dir: "", mirror: false, last: null, backups: [] }));

  // Taking a backup is cheap but writes a full copy of the data: owner only.
  app.post("/backups/run", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.backups) return c.json({ error: "backups are not available" }, 409);
    const result = await deps.backups.run();
    return c.json(result, result.ok ? 200 : 500);
  });

  app.get("/rtc", (c) => c.json(deps.rtc?.status() ?? { enabled: false, turn: false, inert: "not available", subscribed: false, peers: 0, offers: 0, rejected: 0, lastError: null }));

  // The signaling topic is a secret: only the owner creates (or rotates) it.
  app.post("/rtc/topic", (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const topic = newRtcTopic();
    const to = setSetting(db, "rtc", { ...getSetting(db, "rtc"), topic });
    getDefaultRedactor().addSecret(topic);
    ledger.append("_system", "user", "config", { action: "rtc_topic_rotated" });
    deps.rtc?.reload();
    return c.json({ rtc: { ...to, topic: "(set)" } }, 200);
  });

  // What a phone needs to join without a VPN: the rendezvous, the secret topic and a single-use pairing code.
  app.post("/rtc/invite", (c) => {
    const cfg = getSetting(db, "rtc");
    if (!cfg.enabled || !cfg.topic) return c.json({ error: "WebRTC is not enabled" }, 409);
    const principal = c.get("principal");
    try {
      const { code, expiresAt } = auth.createPairingCode(actorOf(principal));
      const invite = deps.rtc?.createInvite();
      if (!invite) return c.json({ error: "WebRTC is not available" }, 409);
      ledger.append("_system", "user", "config", { action: "pairing_code_created", by: actorOf(principal), via: "rtc" });
      // `secret` keys the phone's offer (the 8-char code alone is too weak to key an offline-verifiable MAC).
      return c.json({ server: cfg.server, topic: cfg.topic, stun: cfg.stun, ...(invite.turn ? { turn: invite.turn } : {}), code, secret: invite.secret, expiresAt }, 200);
    } catch (err) {
      if (err instanceof Error && err.message === TOO_MANY_PAIRING_CODES) return c.json({ error: err.message }, 429);
      throw err;
    }
  });

  app.get("/slack", (c) => c.json(deps.slack?.status() ?? { enabled: false, inert: "not available", connected: false, received: 0, sent: 0, dropped: 0, lastError: null, lastEventAt: null, lastFrameAt: null }));

  app.get("/router", (c) => c.json({ strategies: (deps.router?.availability() ?? [{ strategy: "lead", reason: null }]).map(option => {
    const providers = deps.router?.providers(option.strategy) ?? [];
    return { ...option, reason: option.strategy === "lead" || providers.some(p => p.configured) ? null : "Compatible provider credentials are not set", providers };
  }) }));

  app.post("/rooms/:id/router/discover", async c => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const room = getRoom(db, c.req.param("id"));
    if (!room || room.id.startsWith("_")) return c.json({ error: "room not found" }, 404);
    if (!deps.router) return c.json({ error: "the router is not available" }, 503);
    try { return c.json(await deps.router.discover(room, await c.req.json().catch(() => null))); }
    catch (error) { return c.json({ error: error instanceof ModelError ? error.message : "Routing discovery unavailable" }, error instanceof ModelError ? error.status : 503); }
  });

  app.put("/rooms/:id/router", async (c) => {
    // Routing sends the room's messages to a third-party model: the owner decides, not a paired device.
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const room = getRoom(db, c.req.param("id"));
    if (!room || room.id.startsWith("_")) return c.json({ error: "room not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { strategy?: unknown; provider?: unknown; revision?: unknown } | null;
    if (!isRouterStrategy(body?.strategy)) return c.json({ error: "strategy must be lead, jev, openai-decision or cheap-same-model" }, 400);
    try {
      let config = null;
      if (body!.provider !== undefined) {
        if (!deps.router) return c.json({ error: "the router is not available" }, 503);
        config = deps.router.validate(room, body);
      } else {
        if (!z.object({ strategy: z.string(), revision: z.string().optional() }).strict().safeParse(body).success) return c.json({ error: "Invalid routing configuration" }, 400);
        if (room.routerConfig && body!.revision !== deps.router?.revision(room)) return c.json({ error: "Refresh routing before changing an existing provider configuration" }, 409);
        if (body!.revision !== undefined && body!.revision !== deps.router?.revision(room)) return c.json({ error: "Routing changed. Refresh before saving." }, 409);
        if (body!.strategy !== "lead") {
          const entry = deps.router?.availability().find(a => a.strategy === body!.strategy);
          const why = entry?.reason ?? (entry ? null : "the router is not available");
          if (why !== null) return c.json({ error: why }, 409);
        }
      }
      ledger.atomic(() => {
        db.prepare("UPDATE rooms SET router = ?, router_config_json = ? WHERE id = ?").run(body!.strategy, config ? JSON.stringify(config) : null, room.id);
        ledger.append("_system", "owner", "config", { action: "room_router_changed", roomId: room.id, from: room.router ?? "lead", to: body!.strategy, ...(config ? { provider: config.provider, model: config.model } : {}) });
      });
    } catch (error) { return c.json({ error: error instanceof ModelError ? error.message : "Routing configuration could not be saved" }, error instanceof ModelError ? error.status : 503); }
    return c.json({ room: roomView(getRoom(db, room.id)!) });
  });

  // Owner-only room details and additive membership; direct chats keep exactly one agent.
  app.patch("/rooms/:id", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const parsed = z.object({
      name: z.string().trim().min(1).max(80).refine(v => !/[\u0000-\u001f\u007f]/.test(v), "no control characters").optional(),
      description: z.string().trim().max(500).refine(v => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v), "no control characters").optional(),
      leadBotId: z.string().min(1).max(64).optional(),
      addMembers: z.array(z.string().min(1).max(64)).min(1).max(50).refine(ids => new Set(ids).size === ids.length, "duplicate member").optional(),
    }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0) return c.json({ error: "name (1–80 chars), description (up to 500), leadBotId or addMembers required" }, 400);
    const room = getRoom(db, c.req.param("id"));
    if (!room || room.id.startsWith("_")) return c.json({ error: "room not found" }, 404);
    const { name, description, leadBotId, addMembers = [] } = parsed.data;
    if (addMembers.length && room.kind === "direct") return c.json({ error: "agents can only be added to named rooms" }, 400);
    if (addMembers.some(id => !getBot(db, id))) return c.json({ error: "members must be known agent ids" }, 400);
    const added = addMembers.filter(id => !room.members.includes(id));
    if (added.length && room.members.length + added.length > 50) return c.json({ error: "a room can have at most 50 agents" }, 400);
    if (leadBotId !== undefined && !room.members.includes(leadBotId)) return c.json({ error: "the lead must be a member of the room" }, 400);
    const redact = getDefaultRedactor();
    const next = { name: name === undefined ? room.name : redact.redactString(name), description: description === undefined ? room.description ?? "" : redact.redactString(description), leadBotId: leadBotId ?? room.leadBotId };
    ledger.atomic(() => {
      for (const id of added) addMember(db, room.id, id);
      db.prepare("UPDATE rooms SET name = ?, description = ?, lead_bot_id = ? WHERE id = ?").run(next.name, next.description, next.leadBotId, room.id);
      ledger.append("_system", "owner", "config", {
        action: "room_updated",
        roomId: room.id,
        changed: [...(next.name !== room.name ? ["name"] : []), ...(next.description !== (room.description ?? "") ? ["description"] : []), ...(next.leadBotId !== room.leadBotId ? ["lead"] : []), ...(added.length ? ["members"] : [])],
        ...(added.length ? { addedMembers: added } : {}),
        ...(next.leadBotId !== room.leadBotId ? { lead: { from: room.leadBotId, to: next.leadBotId } } : {}),
      });
      // Visible in the room's own history so members can see who answers unmentioned messages now.
      if (next.leadBotId !== room.leadBotId) ledger.append(room.id, "owner", "config", { action: "room_lead_changed", from: room.leadBotId, to: next.leadBotId });
    });
    return c.json({ room: roomView(getRoom(db, room.id)!) });
  });

  app.get("/rooms/:id", (c) => {
    const room = getRoom(db, c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const bots = room.members.map((id) => getBot(db, id)).filter((b): b is Bot => b !== undefined);
    return c.json({ room: roomView(room), bots: bots.map(bot => toBotInfo(bot, deps.modelEnv, getDefaultBotId(db))) });
  });

  // Read-only: which CLIs and providers are usable. Never returns a key, only whether it is set and its last four characters.
  if (deps.botModels) {
    const models = deps.botModels;
    app.get("/models/catalogue", c => {
      if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
      return c.json(models.catalogue.status());
    });
    app.post("/models/catalogue/refresh", async c => {
      if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
      return c.json(await models.catalogue.refresh());
    });
    for (const method of ["GET", "POST", "PUT"] as const) app.on(method, method === "POST" ? "/bots/:id/model/discover" : "/bots/:id/model", async c => {
      if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
      try {
        const id = c.req.param("id")!;
        const result = method === "GET" ? models.read(id) : method === "POST" ? await models.discover(id, await c.req.json().catch(() => null)) : await models.save(id, await c.req.json().catch(() => null));
        return c.json(getDefaultRedactor().redact(result));
      } catch (error) {
        if (error instanceof ModelError) return c.json({ error: error.message }, error.status as 400|403|404|409|503);
        return c.json({ error: "Model operation was not confirmed. Reload configuration before retrying; check server installation and access." }, 503);
      }
    });
  }

  app.get("/models/status", async (c) => c.json(await modelsStatus({ bots: listBots(db) })));

  // MEMORY.md for the desk. Reads are redacted; writes are owner-only, redacted, capped, committed to the data repo and audited by length only.
  app.get("/bots/:id/memory", (c) => {
    const bot = getBot(db, c.req.param("id"));
    if (!bot) return c.json({ error: "bot not found" }, 404);
    const text = deps.dataDir ? readMemoryFull(deps.dataDir, bot.id) : "";
    return c.json({ botId: bot.id, text, maxBytes: MEMORY_MAX_BYTES, headTokens: Math.ceil(text.length / 4), headCap: Number(process.env.OPENAG_MEMORY_TOKENS) || 1500 });
  });

  app.put("/bots/:id/memory", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const bot = getBot(db, c.req.param("id"));
    if (!bot) return c.json({ error: "bot not found" }, 404);
    if (!deps.dataDir) return c.json({ error: "memory is not available" }, 503);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof body?.text !== "string") return c.json({ error: "text must be a string" }, 400);
    if (Buffer.byteLength(body.text, "utf8") > MEMORY_MAX_BYTES) return c.json({ error: `MEMORY.md is limited to ${MEMORY_MAX_BYTES} bytes` }, 400);
    const written = writeMemoryFull(deps.dataDir, bot, body.text);
    deps.vectors?.indexMemoryFile(bot.id, written);
    ledger.append("_system", "user", "config", { action: "memory_edited", botId: bot.id, length: written.length });
    void commitMemory(deps.dataDir, `memory: ${bot.id} edited from the desk`);
    return c.json({ botId: bot.id, text: written });
  });

  app.get("/memory/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim().slice(0, 300);
    const botId = c.req.query("bot") ?? "";
    if (q.length < 2) return c.json({ results: [] });
    if (!deps.vectors || !getBot(db, botId)) return c.json({ error: "embeddings unavailable" }, 503);
    try {
      const hits = await deps.vectors.search(botId, q, 8);
      return c.json({ results: hits.map((h) => ({ text: h.text.slice(0, 400), source: h.source })) });
    } catch {
      return c.json({ error: "embeddings unavailable" }, 503);
    }
  });

  for (const [method, path] of [["GET", "/bots/creation/targets"], ["POST", "/bots/creation/discover"], ["GET", "/bots/creation/requests/:requestId"], ["POST", "/bots"]] as const) {
    app.on(method, path, async c => {
      if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
      try {
        if (method === "GET" && path.endsWith(":requestId")) {
          const bot = readBotCreation(db, c.req.param("requestId")!);
          return c.json({ bot: bot ? toBotInfo(bot, deps.modelEnv, getDefaultBotId(db)) : null });
        }
        if (!deps.botModels) return c.json({ error: "Model setup is unavailable. Ask the server administrator." }, 503);
        if (method === "GET") return c.json({ targets: deps.botModels.creationTargets() });
        const body = await c.req.json().catch(() => null);
        if (path.endsWith("discover")) return c.json(getDefaultRedactor().redact(await deps.botModels.discoverCreation(body)));
        const result = createDeskBot(db, ledger, deps.botModels, body, deps.modelEnv);
        return c.json({ bot: toBotInfo(result.bot, deps.modelEnv, getDefaultBotId(db)), created: result.created }, result.created ? 201 : 200);
      } catch (error) {
        if (error instanceof ModelError) return c.json({ error: error.message }, error.status as 400|403|404|409|503);
        if (error instanceof BotSettingsError) return c.json({ error: error.message }, 400);
        return c.json({ error: "Creation was not confirmed. Check creation status before retrying." }, 503);
      }
    });
  }

  app.get("/bots", (c) => c.json({ bots: listBots(db).map(bot => toBotInfo(bot, deps.modelEnv, getDefaultBotId(db))) }));

  // Editable fields for the bot settings page. Instructions are shown only to the owner, never in GET /bots.
  app.get("/avatars", c => { c.header("cache-control", "no-store"); return c.json({ avatars: avatarLibrary.list() }); });

  app.get("/bots/:id/settings", (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const bot = getBot(db, c.req.param("id"));
    if (!bot) return c.json({ error: "bot not found" }, 404);
    const config = (bot.config ?? {}) as Record<string, unknown>;
    return c.json({
      id: bot.id,
      name: bot.name,
      description: typeof config.description === "string" ? config.description : "",
      maxSteps: typeof config.maxSteps==='number'?config.maxSteps:20,
      instructions: typeof config.instructions === "string" ? config.instructions : "",
      avatar: parseAvatar(config.avatar),
    });
  });

  app.put("/bots/:id/settings", async (c) => {
    const bot = getBot(db, c.req.param("id"));
    if (!bot) return c.json({ error: "bot not found" }, 404);
    let patch;
    try {
      patch = parseBotSettings(await c.req.json().catch(() => undefined));
      if (patch.avatar?.shape.startsWith("custom:") && !avatarLibrary.has(patch.avatar.shape)) throw new BotSettingsError("Select an approved avatar from the library");
    } catch (err) {
      if (err instanceof BotSettingsError) return c.json({ error: err.message }, 400);
      throw err;
    }
    if(patch.maxSteps!==undefined&&bot.runtime!=='api')return c.json({error:'Model-step limits apply to hosted API and Ollama bots'},400);
    if (needsOwner(patch) && c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const redactor = getDefaultRedactor();
    updateBot(db, bot.id, {
      name: patch.name === undefined ? undefined : redactor.redact(patch.name),
      config: {
        ...(patch.maxSteps !== undefined ? {maxSteps:patch.maxSteps}:{}),
        ...(patch.description !== undefined ? { description: redactor.redact(patch.description) } : {}),
        ...(patch.instructions !== undefined ? { instructions: redactor.redact(patch.instructions) } : {}),
        ...(patch.avatar !== undefined ? { avatar: patch.avatar ?? undefined } : {}),
      },
    });
    // The audit line says which fields changed, never the instructions themselves.
    ledger.append("_system", "user", "config", { botId: bot.id, action: "bot_settings", fields: Object.keys(patch) });
    return c.json({ bot: toBotInfo(getBot(db, bot.id)!, deps.modelEnv, getDefaultBotId(db)) });
  });

  app.get("/settings", (c) => {
    // The signaling topic is a secret: it is never listed (the owner creates it, invites carry it).
    const all = listSettings(db);
    return c.json({ settings: { ...all, skillLibrary: getDefaultRedactor().redact(all.skillLibrary), rtc: { ...all.rtc, topic: all.rtc.topic ? "(set)" : null } } });
  });

  app.put("/settings/:key", async (c) => {
    const key = c.req.param("key");
    if (!isSettingKey(key)) return c.json({ error: "setting not found" }, 404);
    // Where the agent's actions run (a hosted browser, a remote box) is the owner's call, not any paired device's.
    if ((key === "profile" || key === "dictation" || key === "skillLibrary" || key === "computer" || key === "apps" || key === "slack" || key === "rtc" || key === "defaultBot" || key === "deliveryRoom" || key === "connectorSignIn") && c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (key === "skillLibrary") return c.json({ error: "Use the shared-library and per-agent assignment controls" }, 400);
    let body: unknown = await c.req.json().catch(() => undefined);
    // The listing masks the topic, so a round-tripped value keeps the stored one.
    if (key === "rtc" && body && typeof body === "object" && (body as { topic?: unknown }).topic === "(set)") body = { ...body, topic: getSetting(db, "rtc").topic };
    if (key === "defaultBot") {
      const botId = (body as { botId?: unknown } | null | undefined)?.botId;
      if (typeof botId !== "string" || !getBot(db, botId)) return c.json({ error: "botId must name an existing bot" }, 400);
    }
    if (key === "deliveryRoom") {
      const roomId = (body as { roomId?: unknown } | null | undefined)?.roomId;
      if (roomId !== null && (typeof roomId !== "string" || roomId.startsWith("_") || !getRoom(db, roomId))) return c.json({ error: "roomId must be null or name an existing room" }, 400);
    }
    const from = getSetting(db, key);
    if (key === "dictation" && body && typeof body === "object") {
      const value = body as { enabled?: unknown; provider?: unknown; model?: unknown; snapshotId?: unknown };
      const previous = getSetting(db, "dictation");
      if (value.model && (value.provider !== previous.provider || value.model !== previous.model)) {
        try {
          if (typeof value.provider !== "string" || typeof value.model !== "string" || typeof value.snapshotId !== "string" || !deps.botModels) throw new ModelError("Refresh models and choose a transcription model", 409);
          const choice = deps.botModels.catalogue.resolve(value.snapshotId, `${value.provider}/${value.model}`, "transcription");
          if (choice.target !== value.provider) throw new ModelError("Transcription provider changed", 409);
        } catch (error) { return c.json({ error: error instanceof ModelError ? error.message : "Transcription model selection is unavailable" }, 409); }
      }
      const { snapshotId: _snapshotId, ...setting } = value;
      body = setting;
    }
    let to: unknown;
    try {
      to = setSetting(db, key, body);
    } catch (err) {
      if (err instanceof SettingsError) return c.json({ error: err.message }, 400);
      throw err;
    }
    if (key === "push") getDefaultRedactor().addSecret((to as Push).topic ?? "");
    if (key === "connectorSignIn") deps.composio?.invalidateFlows();
    if (key === "slack") deps.slack?.reload();
    if (key === "rtc") {
      getDefaultRedactor().addSecret((to as Rtc).topic ?? "");
      deps.rtc?.reload();
    }
    ledger.append("_system", "user", "config", {
      action: "setting_changed",
      key,
      from: auditSetting(key, from),
      to: auditSetting(key, to),
    });
    return c.json({ key, value: key === "rtc" ? { ...(to as Rtc), topic: (to as Rtc).topic ? "(set)" : null } : to }, 200);
  });

  app.get("/wake/decisions", (c) => {
    const raw = c.req.query("limit");
    const parsed = raw === undefined ? 50 : Number(raw);
    const limit = Number.isFinite(parsed) ? Math.min(200, Math.max(1, Math.floor(parsed))) : 50;
    return c.json({ decisions: listWakeDecisions(db, limit) });
  });

  // "Should have pinged": recorded for review only (any paired device; it changes no behaviour).
  app.post("/wake/decisions/:id/feedback", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => null)) as { verdict?: unknown } | null;
    if (!Number.isInteger(id) || id < 1) return c.json({ error: "decision not found" }, 404);
    if (body?.verdict !== "should_have_pinged") return c.json({ error: "verdict must be should_have_pinged" }, 400);
    if (!setWakeFeedback(db, id, "should_have_pinged")) return c.json({ error: "decision not found" }, 404);
    ledger.append("_system", "user", "config", { action: "wake_feedback", decisionId: id, verdict: body.verdict });
    return c.json({ id, feedback: body.verdict });
  });

  app.get("/digest", (c) => {
    const rows = db
      .prepare(
        `SELECT id, ts, bot_id, text, dedupe_key,result_id FROM digest_items WHERE delivered_at IS NULL AND (result_id IS NULL OR result_id IN (${readableResultIdsSQL})) ORDER BY ts, id LIMIT 100`,
      )
      .all(JSON.stringify(deps.responsibilities?.readableScopes()??[])) as { id: number; ts: number; bot_id: string; text: string; dedupe_key: string;result_id:string|null }[];
    return c.json({
      items: rows.map((r) => ({ id: r.id, ts: r.ts, botId: r.bot_id, text: r.text, dedupeKey: r.dedupe_key,...(r.result_id?{resultId:r.result_id}:{}) })),
    });
  });

  // "Send it now": bypasses enabled/days/window, but an empty brief is still not sent.
  app.post("/brief", (c) => {
    const result = deliverBrief({ db, ledger, now: new Date(now()), tz, force: true,readableScopes:()=>deps.responsibilities?.readableScopes()??[] });
    return c.json(result, 200);
  });

  if (deps.reflection) {
    const reflection = deps.reflection;
    app.get("/reflection", (c) => c.json(reflection.status()));
    // Owner/Full manual run: ignores `enabled`. Refused (409) while busy or without a bot.
    app.post("/reflection/run", async (c) => {
      if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
      const r = await reflection.runNow(true);
      return r.started ? c.json({ started: true }, 202) : c.json({ error: r.reason ?? "reflection refused" }, 409);
    });
  }

  // MCP servers: status for every device; the editable detail and the write routes below are owner-only and cover custom remote servers only (ADR 0003).
  app.get("/app-library/setup/:id", (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.dataDir) return c.json({ error: "local setup is unavailable" }, 503);
    if (!["hello", "local-reference", "apple-apps"].includes(c.req.param("id"))) return c.json({ error: "unsupported setup package" }, 404);
    try { return c.json(getDefaultRedactor().redact(setupReview(deps.dataDir, c.req.param("id")))); }
    catch { return c.json({ error: "Setup review is unavailable. Check bundled source and the target directory/configuration locally; nothing was installed." }, 409); }
  });

  app.get("/connectors", (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    return c.json({ google: deps.google?.status() ?? null, apple: deps.apple?.status() ?? null });
  });
  app.post("/connectors/apple/:action", async c => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.apple) return c.json({ error: "Apple access is unavailable" }, 503);
    try {
      const body = z.object({ app: z.string().max(32) }).strict().parse(await c.req.json());
      if (c.req.param("action") === "permission") return c.json(await deps.apple.permission(body.app));
      if (c.req.param("action") === "verify") return c.json(await deps.apple.verify(body.app));
      return c.json({ error: "Unknown Apple operation" }, 404);
    } catch { return c.json({ error: "Apple access check failed. Check the connector and app permissions on the daemon machine." }, 400); }
  });
  app.get("/connectors/composio", c => c.json(deps.composio?.status(c.req.query("origin")) ?? { configured: false, state: "setup", reason: "Composio is unavailable", hasAccount: false }));
  app.post("/connectors/composio/:action", async c => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.composio) return c.json({ error: "Composio setup is unavailable" }, 503);
    const actor = actorOf(c.get("rawPrincipal"));
    try {
      const action = c.req.param("action"), body = await c.req.json();
      if (action === "complete") { await deps.composio.complete(body, actor, canCompleteSignIn); return c.json({ connected: true }); }
      if (action === "start") {
        const { origin } = z.object({ origin: z.string().max(2048).optional() }).strict().parse(body);
        return c.json(await deps.composio.start(actor, origin, canCompleteSignIn));
      }
      if (action === "status" || action === "cancel") {
        const { attempt } = z.object({ attempt: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(body);
        return c.json(action === "status" ? await deps.composio.attempt(attempt, actor, canCompleteSignIn) : deps.composio.cancel(attempt, actor));
      }
      z.object({}).strict().parse(body);
      if (action === "disconnect") return c.json(await deps.composio.disconnect());
      return c.json({ error: "Unknown connector operation" }, 404);
    } catch { return c.json({ error: "Composio operation failed. Check setup, sign-in and current connection status." }, 400); }
  });
  app.post("/connectors/google/:action", async c => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.google) return c.json({ error: "Google setup is unavailable" }, 503);
    const actor = actorOf(c.get("rawPrincipal"));
    try {
      const action = c.req.param("action");
      const body = await c.req.json();
      if (action === "start") { const b = z.object({ service: z.string().max(32) }).strict().parse(body); return c.json(deps.google.start(b.service, actor)); }
      if (action === "complete") { await deps.google.complete(body, actor); return c.json({ connected: true }); }
      if (action === "pause") { const b = z.object({ service: z.string().max(32), enabled: z.boolean() }).strict().parse(body); deps.google.pause(b.service, b.enabled); return c.json({ updated: true }); }
      if (action === "verify") { const b = z.object({ service: z.string().max(32) }).strict().parse(body); return c.json(await deps.google.verify(b.service)); }
      if (action === "disconnect") { z.object({}).strict().parse(body); return c.json(await deps.google.disconnect()); }
      return c.json({ error: "Unknown connector operation" }, 404);
    } catch { return c.json({ error: "Connector operation failed. Check setup, account access and the current connection status." }, 400); }
  });

  app.get("/app-library", (c) => c.json(getDefaultRedactor().redact(appLibrary(deps.apps, deps.mcp, deps.google, deps.composio))));

  app.get("/mcp/servers", (c) => c.json(getDefaultRedactor().redact(mcpBody(deps.mcp, c.get("principal").kind === "owner"))));
  app.post("/mcp/reload", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (deps.mcp) await deps.mcp.reload();
    ledger.append("_system", "owner", "config", { action: "mcp_reloaded" });
    return c.json(mcpBody(deps.mcp, true));
  });

  // Owner-only management of custom MCP servers. Values never enter responses or audit events: header NAMES and ids only.
  // The gate runs before the body is read, so nobody else can probe the schema.
  const mcpServerGate = (c: Context<AppEnv>) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.mcpServers || !deps.mcp) return c.json({ error: "MCP management is unavailable" }, 503);
    return undefined;
  };
  const mcpServerReply = async (c: Context<AppEnv>, run: () => Promise<McpServerChange>, status: 200 | 201) => {
    try {
      const change = await run();
      ledger.append("_system", "owner", "config", { action: `mcp_server_${change.action}`, id: change.id, headerNames: change.headerNames, by: actorOf(c.get("principal")) });
      return c.json(getDefaultRedactor().redact({ change: { id: change.id, action: change.action, digest: change.digest, status: change.status ?? null }, ...mcpBody(deps.mcp, true) }), status);
    } catch (error) {
      if (error instanceof McpServerError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  };
  const mcpInputProblem = (error: { issues: { path: PropertyKey[]; message: string }[] }) => `Invalid MCP server: ${error.issues[0]?.path.join(".") || "request"}: ${error.issues[0]?.message ?? "not valid"}`;
  app.post("/mcp/servers", async (c) => {
    const refused = mcpServerGate(c); if (refused) return refused;
    const parsed = addServerSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: mcpInputProblem(parsed.error) }, 400);
    return mcpServerReply(c, () => deps.mcpServers!.add(parsed.data), 201);
  });
  // Registered before the :id routes. The check only proposes: the daemon contacts nothing until the approval is accepted.
  app.post("/mcp/servers/check", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.mcpCheck) return c.json({ error: "MCP server checks are unavailable" }, 503);
    const parsed = checkCandidateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: mcpInputProblem(parsed.error) }, 400);
    try { return c.json(deps.mcpCheck.request(parsed.data), 202); }
    catch (error) {
      if (error instanceof McpServerError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  app.get("/mcp/servers/check/:approvalId", (c) => {
    c.header("cache-control", "no-store");
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.mcpCheck) return c.json({ error: "MCP server checks are unavailable" }, 503);
    const state = deps.mcpCheck.result(c.req.param("approvalId"));
    return state ? c.json(getDefaultRedactor().redact(state)) : c.json({ error: "check not found" }, 404);
  });
  // OAuth sign-in for one custom remote server. Owner only; the daemon-managed callback route is the only way back, and nothing here returns a token.
  const oauthGate = (c: Context<AppEnv>) => {
    c.header("cache-control", "no-store");
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.mcpOAuth) return c.json({ error: "OAuth sign-in is unavailable" }, 503);
    return undefined;
  };
  const oauthReply = async (c: Context<AppEnv>, run: () => Promise<unknown> | unknown) => {
    try { return c.json(await run() as object); }
    catch (error) {
      if (error instanceof McpOAuthError) return c.json({ error: error.message }, error.status);
      if (error instanceof z.ZodError) return c.json({ error: "Invalid sign-in request" }, 400);
      return c.json({ error: "OAuth operation failed. Check the server settings and try again." }, 400);
    }
  };
  app.get("/mcp/servers/:id/oauth", async c => { const refused = oauthGate(c); if (refused) return refused; return oauthReply(c, () => deps.mcpOAuth!.status(c.req.param("id"))); });
  app.post("/mcp/servers/:id/oauth/:action", async c => {
    const refused = oauthGate(c); if (refused) return refused;
    const id = c.req.param("id"), action = c.req.param("action"), actor = actorOf(c.get("rawPrincipal"));
    const body = await c.req.json().catch(() => ({}));
    return oauthReply(c, async () => {
      if (action === "start") {
        const { origin } = z.object({ origin: z.string().max(2048).optional() }).strict().parse(body);
        const started = await deps.mcpOAuth!.start(id, actor, origin, canCompleteSignIn);
        ledger.append("_system", "owner", "config", { action: "mcp_oauth_started", id, route: started.route, by: actorOf(c.get("principal")) });
        return started;
      }
      if (action === "status" || action === "cancel") {
        const { attempt } = z.object({ attempt: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(body);
        return action === "status" ? await deps.mcpOAuth!.attempt(attempt, actor, canCompleteSignIn) : deps.mcpOAuth!.cancel(attempt, actor);
      }
      if (action === "disconnect") { z.object({}).strict().parse(body); return await deps.mcpOAuth!.disconnect(id); }
      throw new McpOAuthError("Unknown sign-in operation", 404);
    });
  });
  // The owner's own registered client (client ID and, if the provider issued one, a secret). Write-only; the secret is never returned.
  app.put("/mcp/servers/:id/oauth/client", async c => {
    const refused = oauthGate(c); if (refused) return refused;
    const id = c.req.param("id");
    return oauthReply(c, async () => {
      const body = z.object({ clientId: z.string().min(1).max(512), clientSecret: z.string().min(1).max(4096).optional() }).strict().parse(await c.req.json().catch(() => null));
      const entry = deps.mcp?.entries().servers.find(server => server.id === id);
      if (!entry || entry.origin !== "custom" || entry.transport !== "http" || !entry.url || !entry.oauth) throw new McpOAuthError("This server does not use OAuth", 409);
      await deps.mcpOAuth!.setClient(id, body.clientId, body.clientSecret, new URL(entry.url).origin);
      ledger.append("_system", "owner", "config", { action: "mcp_oauth_client_set", id, hasSecret: body.clientSecret !== undefined, by: actorOf(c.get("principal")) });
      await deps.mcp?.applyServer(id);
      return { ok: true };
    });
  });
  app.delete("/mcp/servers/:id/oauth/client", async c => {
    const refused = oauthGate(c); if (refused) return refused;
    const id = c.req.param("id");
    return oauthReply(c, async () => { await deps.mcpOAuth!.removeClient(id); ledger.append("_system", "owner", "config", { action: "mcp_oauth_client_removed", id, by: actorOf(c.get("principal")) }); return { ok: true }; });
  });

  // Local commands written from the desk: proposing only creates an approval; nothing is written or started until it is accepted.
  app.post("/mcp/servers/command-review", async (c) => {
    c.header("cache-control", "no-store");
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.mcpCommandReview) return c.json({ error: "Command reviews are unavailable" }, 503);
    const parsed = commandProposalSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: mcpInputProblem(parsed.error) }, 400);
    try { return c.json(deps.mcpCommandReview.request(parsed.data), 202); }
    catch (error) {
      if (error instanceof McpServerError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  app.get("/mcp/servers/command-review/:approvalId", (c) => {
    c.header("cache-control", "no-store");
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    if (!deps.mcpCommandReview) return c.json({ error: "Command reviews are unavailable" }, 503);
    const state = deps.mcpCommandReview.result(c.req.param("approvalId"));
    return state ? c.json(getDefaultRedactor().redact(state)) : c.json({ error: "review not found" }, 404);
  });
  app.patch("/mcp/servers/:id", async (c) => {
    const refused = mcpServerGate(c); if (refused) return refused;
    const parsed = updateServerSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: mcpInputProblem(parsed.error) }, 400);
    return mcpServerReply(c, () => deps.mcpServers!.update(c.req.param("id"), parsed.data), 200);
  });
  app.delete("/mcp/servers/:id", async (c) => {
    const refused = mcpServerGate(c); if (refused) return refused;
    const parsed = removeServerSchema.safeParse({ digest: c.req.query("digest") });
    if (!parsed.success) return c.json({ error: mcpInputProblem(parsed.error) }, 400);
    return mcpServerReply(c, () => deps.mcpServers!.remove(c.req.param("id"), parsed.data), 200);
  });

  // Direct secrets for custom servers: write-only. Responses and audit events carry names and the last four characters at most.
  const mcpSecretReply = async <T,>(c: Context<AppEnv>, run: () => Promise<T> | T) => {
    try { return await run(); }
    catch (error) {
      if (error instanceof McpServerError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  };
  app.get("/mcp/secrets", async (c) => {
    c.header("cache-control", "no-store");
    const refused = mcpServerGate(c); if (refused) return refused;
    const result = await mcpSecretReply(c, () => deps.mcpServers!.listSecrets());
    return Array.isArray(result) ? c.json({ secrets: result }) : result;
  });
  app.put("/mcp/secrets/:serverId/:name", async (c) => {
    c.header("cache-control", "no-store");
    const refused = mcpServerGate(c); if (refused) return refused;
    const parsed = z.object({ value: z.string(), origin: z.string().max(300).optional() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid MCP secret: send {value}" }, 400);
    const serverId = c.req.param("serverId"), name = c.req.param("name");
    const result = await mcpSecretReply(c, () => deps.mcpServers!.setSecret(serverId, name, parsed.data.value, parsed.data.origin));
    if (result instanceof Response) return result;
    ledger.append("_system", "owner", "config", { action: "mcp_secret_set", id: serverId, name, by: actorOf(c.get("principal")) });
    return c.json({ secret: result, ...mcpBody(deps.mcp, true) });
  });
  app.delete("/mcp/secrets/:serverId/:name", async (c) => {
    c.header("cache-control", "no-store");
    const refused = mcpServerGate(c); if (refused) return refused;
    const serverId = c.req.param("serverId"), name = c.req.param("name");
    const result = await mcpSecretReply(c, async () => { await deps.mcpServers!.removeSecret(serverId, name); return true; });
    if (result instanceof Response) return result;
    ledger.append("_system", "owner", "config", { action: "mcp_secret_removed", id: serverId, name, by: actorOf(c.get("principal")) });
    return c.json({ ok: true, ...mcpBody(deps.mcp, true) });
  });

  app.get("/dictation", async c => {
    const setting = getSetting(db, "dictation"), choices = [];
    for (const provider of ["openai", "ollama"] as const) {
      try {
        const choice = deps.botModels?.catalogue.read(provider, undefined, "transcription");
        if (choice) choices.push({ provider, models: choice.models.map(model => ({ ...model, snapshotId: deps.botModels!.catalogue.read(provider, model.id, "transcription").snapshotId })) });
      } catch { /* Saved targets remain usable while discovery is unavailable. */ }
    }
    return c.json({ ...await transcriptionStatus(setting, deps.transcriptionFetch, deps.botModels?.catalogue.capabilities(`${setting.provider}/${setting.model}`), deps.botModels?.catalogue.contains(`${setting.provider}/${setting.model}`)), choices });
  });
  const dictating = new Set<string>();
  app.post("/rooms/:id/dictation", bodyLimit({ maxSize: AUDIO_MAX_BYTES, onError: c => c.json({ error: "recording exceeds 8 MiB" }, 413) }), async c => {
    const room = getRoom(db, c.req.param("id"));
    if (!room || room.id.startsWith("_")) return c.json({ error: "room not found" }, 404);
    const setting = getSetting(db, "dictation"), status = await transcriptionStatus(setting, deps.transcriptionFetch, deps.botModels?.catalogue.capabilities(`${setting.provider}/${setting.model}`), deps.botModels?.catalogue.contains(`${setting.provider}/${setting.model}`));
    if (!status.available) return c.json({ error: status.reason }, 503);
    if (c.req.header("x-transcription-target") !== status.target) return c.json({ error: "Dictation settings changed. Start a new recording." }, 409);
    const actor = actorOf(c.get("rawPrincipal"));
    if (dictating.has(actor) || dictating.size >= 2) return c.json({ error: "Dictation is busy; wait for the current request" }, 429);
    dictating.add(actor);
    try {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (!auth.authenticate(c.req.header("authorization")?.slice(7))) return c.json({ error: "unauthorized" }, 401);
      if (JSON.stringify(getSetting(db, "dictation")) !== JSON.stringify(setting)) return c.json({ error: "Dictation settings changed. Start a new recording." }, 409);
      const text = await transcribe(bytes, (c.req.header("content-type") ?? "").split(";")[0]!.trim(), setting, c.req.raw.signal, deps.transcriptionFetch);
      if (!auth.authenticate(c.req.header("authorization")?.slice(7))) return c.json({ error: "unauthorized" }, 401);
      return c.json({ text }, 200, { "cache-control": "no-store" });
    } catch (error) { if (error instanceof TranscriptionError) return c.json({ error: error.message }, error.status as 400|403|404|409|503); throw error; }
    finally { dictating.delete(actor); }
  });
  const uploads = deps.dataDir ? createUploads(db, deps.dataDir) : undefined;
  app.post("/rooms/:id/uploads", bodyLimit({ maxSize: UPLOAD_FILE_MAX, onError: c => c.json({ error: "file exceeds 5 MiB" }, 413) }), async c => {
    if (!uploads) return c.json({ error: "uploads unavailable" }, 503);
    const room = getRoom(db, c.req.param("id")); if (!room || room.id.startsWith("_")) return c.json({ error: "room not found" }, 404);
    try {
      let name: string; try { name = decodeURIComponent(c.req.header("x-file-name") ?? ""); } catch { throw new UploadError("invalid attachment name"); }
      return c.json({ attachment: uploads.save(room.id, name, (c.req.header("content-type") ?? "").split(";")[0]!.trim(), new Uint8Array(await c.req.arrayBuffer())) }, 201);
    } catch (error) { if (error instanceof UploadError || error instanceof AgentRequestError || error instanceof QuestionError || error instanceof WorkError) return c.json({ error: error.message }, error.status as 400|403|404|409|503); throw error; }
  });
  app.get("/rooms/:id/uploads/:uploadId", c => {
    const room = getRoom(db, c.req.param("id")); if (!room || room.id.startsWith("_")) return c.json({ error: "room not found" }, 404);
    if (!uploads) return c.json({ error: "uploads unavailable" }, 503);
    try { const r = uploads.get(c.req.param("id"), c.req.param("uploadId")); return c.body(new Uint8Array(r.bytes), 200, { "content-type": r.attachment.mimeType, "x-content-type-options": "nosniff", "content-disposition": "attachment", "cache-control": "no-store" }); }
    catch (error) { if (error instanceof UploadError || error instanceof AgentRequestError || error instanceof QuestionError || error instanceof WorkError) return c.json({ error: error.message }, error.status as 400|403|404|409|503); throw error; }
  });
  app.delete("/rooms/:id/uploads/:uploadId", c => {
    const room = getRoom(db, c.req.param("id")); if (!room || room.id.startsWith("_")) return c.json({ error: "room not found" }, 404);
    if (!uploads) return c.json({ error: "uploads unavailable" }, 503);
    try { uploads.remove(c.req.param("id"), c.req.param("uploadId")); return c.body(null, 204); }
    catch (error) { if (error instanceof UploadError || error instanceof AgentRequestError || error instanceof QuestionError || error instanceof WorkError) return c.json({ error: error.message }, error.status as 400|403|404|409|503); throw error; }
  });

  app.get('/rooms/:id/agent-requests', c => {c.header('cache-control','no-store');if(!getRoom(db,c.req.param('id')))return c.json({error:'room not found'},404);return c.json({requests:deps.agentRequests?.list(c.req.param('id'))??[]});});
  app.get('/rooms/:id/agent-requests/:requestId/request-manifests',c=>{
    c.header('cache-control','no-store');
    if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
    if(!deps.agentRequests)return c.json({error:'Agent requests unavailable'},503);
    const raw=c.req.query('before'),before=raw===undefined?undefined:Number(raw);
    if(before!==undefined&&(!Number.isSafeInteger(before)||before<=0))return c.json({error:'invalid page'},400);
    try{const id=deps.agentRequests.manifestTurn(c.req.param('id'),c.req.param('requestId'));return c.json(id?requestPage(db,id,before):{records:[],nextCursor:null,receipts:[]});}
    catch(error){if(error instanceof AgentRequestError)return c.json({error:error.message},error.status as 400|403|404|409|503);throw error;}
  });
  app.post('/rooms/:id/agent-requests/:requestId/cancel', c => {
    if(!deps.agentRequests)return c.json({error:'Agent requests unavailable'},503);
    try{return c.json({request:deps.agentRequests.cancel(c.req.param('requestId'),c.req.param('id'))});}
    catch(error){if(error instanceof AgentRequestError)return c.json({error:error.message},error.status as 400|403|404|409|503);throw error;}
  });

  app.post("/rooms/:id/messages", async (c) => {
    const room = getRoom(db, c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown; attachments?: unknown; replyToQuestion?:unknown; replyToMessageId?: unknown } | null;
    if (!body || typeof body.text !== "string" || (body.text.trim() === "" && !Array.isArray(body.attachments))) {
      return c.json({ error: "text is required" }, 400);
    }
    let reply: MessageReply | undefined;
    if (body.replyToMessageId !== undefined) {
      try { reply = resolveMessageReply(ledger, room.id, body.replyToMessageId); }
      catch { return c.json({ error: 'Choose a message in this conversation to reply to.' }, 400); }
    }
    try {
      if(body.replyToQuestion!==undefined){
        if(body.replyToMessageId!==undefined)return c.json({error:'Choose a question reply or a quoted message.'},400);
        if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
        const reply=z.object({id:z.string().uuid(),revision:z.number().int().positive()}).strict().safeParse(body.replyToQuestion);
        if(!reply.success||!inputAnswer.shape.answer.safeParse(body.text).success)return c.json({error:'A valid question reply and 1–8000 characters are required.'},400);
        const result=await postQuestionAnswer(reply.data.id,reply.data.revision,body.text,room.id,body.attachments);return c.json(result,result.duplicate?200:202);
      }
      const files = body.attachments === undefined ? [] : uploads?.prepare(room.id, body.attachments);
      if (!files) return c.json({ error: "uploads unavailable" }, 503);
      if (!body.text.trim() && !files.length) return c.json({ error: "message or attachment is required" }, 400);
      const botIds=room.kind==='direct'&&deps.agentRequests?directTargets(body.text,room,listBots(db).map(b=>b.id)):undefined;
      if(botIds)deps.agentRequests!.prepareMentions(room,body.text,botIds);
      const { message, route } = await ingress.post(room, body.text, { ...(botIds?{botIds}:{}), extra: { ...(reply ? { reply } : {}), ...(files.length ? { attachments: files } : {}) }, ...(files.length?{onMessage:m=>uploads!.bind(room.id,files.map(f=>f.id),m.id)}:{}) });
      return c.json({ message, route }, 202);
    } catch (error) { if (error instanceof UploadError || error instanceof AgentRequestError || error instanceof QuestionError || error instanceof WorkError) return c.json({ error: error.message }, error.status as 400|403|404|409|503); throw error; }
  });

  app.get("/rooms/:id/events", (c) => {
    const room = getRoom(db, c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const after = Number(c.req.query("after") ?? 0);
    if (!Number.isFinite(after) || after < 0) return c.json({ error: "bad after" }, 400);
    return c.json({ events: ledger.list(room.id, { afterId: after }).map(publicRequestEvent) });
  });

  app.get('/turns/:id/request-manifests',c=>{
    c.header('cache-control','no-store');
    if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
    const turn=db.prepare('SELECT room_id FROM turns WHERE id=?').get(c.req.param('id')) as {room_id:string}|undefined;
    if(!turn||isPrivateExecutionRoom(turn.room_id))return c.json({error:'turn not found'},404);
    const raw=c.req.query('before'),before=raw===undefined?undefined:Number(raw);
    if(before!==undefined&&(!Number.isSafeInteger(before)||before<=0))return c.json({error:'invalid page'},400);
    return c.json(requestPage(db,c.req.param('id'),before));
  });

  app.get("/approvals", (c) => {
    const status = c.req.query("status") ?? "pending";
    if (status !== "pending") return c.json({ error: "only status=pending is supported" }, 400);
    return c.json({ approvals: approvals.listPending().map(approvalView) });
  });

  app.get("/approvals/:id", c => {
    c.header("cache-control","no-store");
    const approval=approvals.get(c.req.param("id"));
    const receipt=approvals.receipts.get(c.req.param("id"));
    return approval||receipt ? c.json({approval:approval?approvalView(approval):null,receipt:receipt?receiptView(receipt):null}) : c.json({error:"receipt not found"},404);
  });

  app.post("/approvals/:id/inspection",async c=>{
    if(c.get("principal").kind!=="owner")return c.json({error:"owner token required"},403);
    const parsed=z.object({reviewVersion:z.string().min(1).max(100),note:z.string().trim().min(10).max(1000),reference:z.string().trim().min(3).max(300)}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)return c.json({error:"Record the target you inspected and what you found."},400);
    try{return c.json({receipt:receiptView(approvals.inspectReceipt(c.req.param("id"),parsed.data.reviewVersion,parsed.data.note,parsed.data.reference))});}
    catch{return c.json({error:"Receipt changed or no longer needs inspection."},409);}
  });
  app.get("/work/:id/receipts",c=>{
    c.header("cache-control","no-store");
    if(!deps.work?.get(c.req.param("id")))return c.json({error:"work not found"},404);
    const parsed=workPage.safeParse(c.req.query());
    if(!parsed.success)return c.json({error:"invalid page"},400);
    return c.json(approvals.receipts.forWork(c.req.param("id"),parsed.data.before));
  });

  app.post("/approvals/:id", async (c) => {
    // Accepting a command review starts a program on the host: only the owner (a Full device counts) may decide it, never a limited device or peer.
    const target = approvals.get(c.req.param("id"));
    if ((target?.toolName === "mcp_command_review" || target?.toolName === "mcp_server_check") && c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const body = (await c.req.json().catch(() => null)) as
      | { kind?: string; payload?: unknown; text?: unknown; reviewVersion?: unknown }
      | null;
    let decision: Decision;
    switch (body?.kind) {
      case "accept":
        decision = { kind: "accept" };
        break;
      case "edit":
        decision = { kind: "edit", payload: body.payload };
        break;
      case "respond":
        if (typeof body.text !== "string") return c.json({ error: "text is required" }, 400);
        decision = { kind: "respond", text: body.text };
        break;
      case "ignore":
        decision = { kind: "ignore" };
        break;
      default:
        return c.json({ error: "kind must be accept|edit|respond|ignore" }, 400);
    }
    try {
      return c.json({ approval: approvals.resolve(c.req.param("id"), decision,typeof body?.reviewVersion==="string"?body.reviewVersion:"") });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, err instanceof ApprovalError ? err.status : err instanceof z.ZodError ? 400 : msg.includes("not found") ? 404 : 409);
    }
  });

  const permissions=deps.permissions??(deps.dataDir?createPermissions(db,ledger,deps.dataDir,deps.approvals):undefined);
  if (permissions) {
    app.get('/permissions/adoption',c=>c.json(c.get('principal').kind==='owner'?permissions.adoption():{active:permissions.active()}));
    app.post('/permissions/adoption',async c=>{
      if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
      const parsed=z.object({preset:z.enum(PERMISSION_PRESETS),reviewVersion:z.string().length(64),reviewedLegacy:z.literal(true),acknowledgeFullAccess:z.boolean().optional()}).strict().safeParse(await c.req.json().catch(()=>null));
      if(!parsed.success||(parsed.data.preset==='full-access'&&!parsed.data.acknowledgeFullAccess))return c.json({error:'Review the archived rules and acknowledge the replacement and Full access risks'},400);
      try{return c.json(permissions.adopt(parsed.data.preset,parsed.data.reviewVersion,'owner'));}catch{return c.json({error:'Migration review changed; reload before adoption'},409);}
    });
    const selection=z.object({preset:z.enum(PERMISSION_PRESETS),revision:z.number().int().nonnegative(),acknowledgeFullAccess:z.boolean().optional(),writeRoots:z.array(z.string().min(1).max(4096)).max(16).optional()}).strict();
    app.get('/permissions/default',c=>c.json({...permissions.defaults(),adoptionRequired:!permissions.active()}));
    app.put('/permissions/default',async c=>{
      if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
      const parsed=selection.omit({writeRoots:true}).safeParse(await c.req.json().catch(()=>null));
      if(!parsed.success||(parsed.data.preset==='full-access'&&!parsed.data.acknowledgeFullAccess))return c.json({error:'A valid preset, revision and Full access acknowledgement are required'},400);
      try{return c.json(permissions.setDefault(parsed.data.preset,'owner',parsed.data.revision));}catch{return c.json({error:'Defaults changed; reload before saving'},409);}
    });
    app.get('/bots/:id/permissions',c=>{
      try{return c.json(permissions.inspect(c.req.param('id'),c.req.query('roomId')??''));}catch{return c.json({error:'Permission session requires a room member'},404);}
    });
    app.put('/bots/:id/permissions',async c=>{
      if(c.get('principal').kind!=='owner')return c.json({error:'owner token required'},403);
      const parsed=selection.safeParse(await c.req.json().catch(()=>null));
      if(!parsed.success||(parsed.data.preset==='full-access'&&!parsed.data.acknowledgeFullAccess))return c.json({error:'A valid preset, revision and Full access acknowledgement are required'},400);
      try{return c.json(permissions.select(c.req.param('id'),c.req.query('roomId')??'',parsed.data.preset,'owner',parsed.data.revision,parsed.data.writeRoots));}catch{return c.json({error:'Permission session changed or write roots are unavailable; reload before saving'},409);}
    });
  }

  app.all('/bots/:id/tool-modes',c=>c.json({error:'Category permissions are retired. Use session permissions; previous rules are an owner-readable archive.'},410));
  app.all('/bots/:id/tool-modes/:class',c=>c.json({error:'Category permission writes are retired. Use session permissions.'},410));

  app.get("/skills/library", (c) => c.json(skills?.status() ?? { enabled: false, source: "~/.agents/skills", note: "Skills unavailable" }));
  app.put("/skills/library", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !skills) return c.json({ error: "Invalid shared library setting" }, 400);
    skills.setEnabled(parsed.data.enabled);
    await deps.skillsChanged?.();
    ledger.append("_system", "user", "config", { action: "skill_library_changed", enabled: parsed.data.enabled });
    return c.json(skills.status());
  });
  app.get("/skills", (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const botId = c.req.query("botId") ?? "";
    if (!getBot(db, botId)) return c.json({ error: "bot not found" }, 404);
    return c.json({ skills: skills?.list(botId, true) ?? [] });
  });
  app.get("/skills/package", (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const botId = c.req.query("botId") ?? "";
    if (!getBot(db, botId)) return c.json({ error: "bot not found" }, 404);
    const skill = skills?.inspect(botId, c.req.query("id") ?? "");
    return skill ? c.json({ skill }) : c.json({ error: "skill not found" }, 404);
  });
  app.put("/bots/:id/skills/assignments", async (c) => {
    if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
    const botId = c.req.param("id");
    if (!getBot(db, botId)) return c.json({ error: "bot not found" }, 404);
    const parsed = z.object({ ids: z.array(z.string().max(263)).max(200) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !skills) return c.json({ error: "Invalid skill assignments" }, 400);
    try { skills.assign(botId, parsed.data.ids); } catch (err) {
      if (err instanceof SkillError || err instanceof SettingsError) return c.json({ error: err.message }, 400);
      throw err;
    }
    await deps.skillsChanged?.();
    ledger.append("_system", "user", "config", { action: "skill_assignments_changed", botId, count: parsed.data.ids.length });
    return c.json({ skills: skills.list(botId, true) });
  });
  app.get("/bots/:id/skills", (c) => {
    const botId = c.req.param("id");
    if (!getBot(db, botId)) return c.json({ error: "bot not found" }, 404);
    return c.json({ skills: skills?.list(botId) ?? [] });
  });

  app.get("/bots/:id/skills/:slug", (c) => {
    const botId = c.req.param("id");
    if (!getBot(db, botId)) return c.json({ error: "bot not found" }, 404);
    const path = c.req.query("path");
    if (path !== undefined) {
      const resource = skills?.resource(botId, c.req.param("slug"), path);
      return resource ? c.json({ resource }) : c.json({ error: "resource unavailable as a permitted UTF-8 reference" }, 404);
    }
    const skill = skills?.load(botId, c.req.param("slug"));
    if (!skill) return c.json({ error: "skill not found" }, 404);
    return c.json({ skill });
  });

  const push = deps.push;
  if (push) {
    app.post("/push/topic", (c) => {
      const topic = newPushTopic();
      const from = getSetting(db, "push");
      const to = setSetting(db, "push", { ...from, topic });
      getDefaultRedactor().addSecret(topic);
      ledger.append("_system", "user", "config", {
        action: "setting_changed",
        key: "push",
        from: auditSetting("push", from),
        to: auditSetting("push", to),
      });
      return c.json({ topic }, 200);
    });

    app.post("/push/test", async (c) => {
      const st = push.status();
      if (!st.enabled || !st.configured) return c.json({ error: NOT_CONFIGURED_MSG }, 409);
      return c.json(await push.sendTest(), 200);
    });

    app.get("/push/status", (c) => c.json(push.status()));
  }

  const am = deps.automations;
  if (am) {
    const automationError = (c: Context<AppEnv>, err: unknown) => {
      if (err instanceof AutomationError) return c.json({ error: err.message }, 400);
      throw err;
    };
    const jsonObject = async (c: Context<AppEnv>): Promise<Record<string, unknown> | undefined> => {
      const body: unknown = await c.req.json().catch(() => undefined);
      return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
    };

    // Hook kinds expose the path a sender should POST to. Secrets are never part of these responses.
    // Polling automations have no slug and no inbound path: they are never shown as a hook.
    const publicAutomation = (a: Automation) =>
      a.triggerKind === "cron" || a.triggerKind === "github_poll" ? a : { ...a, hookPath: `/hooks/${a.hookSlug}` };

    app.get("/automation-runs",c=>{
      c.header('cache-control','no-store');const parsed=automationRunQuery.safeParse(c.req.query());
      return parsed.success?c.json(am.runs.list(parsed.data)):c.json({error:'invalid run page'},400);
    });
    app.get("/automation-runs/:id",c=>{c.header('cache-control','no-store');const run=am.runs.get(c.req.param('id'));return run?c.json({run}):c.json({error:'run not found'},404);});
    app.get("/automations", (c) => c.json({ automations: am.list().map(publicAutomation) }));

    app.post("/automations", async (c) => {
      const body = await jsonObject(c);
      if (!body) return c.json({ error: "body must be a JSON object" }, 400);
      try {
        const created = am.create(body, actorOf(c.get("principal")));
        return c.json(
          { automation: publicAutomation(created.automation), ...(created.secret !== undefined ? { secret: created.secret } : {}) },
          201,
        );
      } catch (err) {
        return automationError(c, err);
      }
    });

    app.get("/automations/schedule-preview", c => {
      if (c.get("principal").kind !== "owner") return c.json({error: "owner token required"}, 403);
      c.header("cache-control", "no-store");
      const parsed = z.object({scheduleCron: z.string().trim().min(1).max(256), tz: z.string().min(1).max(100).optional(), outputMode: z.enum(["room", "wake"]), enabled: z.enum(["true", "false"])}).strict().safeParse(c.req.query());
      if (!parsed.success) return c.json({error: "Invalid schedule preview request"}, 400);
      try { return c.json(am.previewSchedule({...parsed.data, enabled: parsed.data.enabled === "true"})); }
      catch (err) { return automationError(c, err); }
    });

    app.get("/automations/:id", (c) => {
      const automation = am.get(c.req.param("id"));
      if (!automation) return c.json({ error: "automation not found" }, 404);
      return c.json({ automation: publicAutomation(automation) });
    });

    // Webhook only. The new secret is in this response once and never again.
    app.post("/automations/:id/secret", (c) => {
      try {
        const rotated = am.rotateSecret(c.req.param("id"), actorOf(c.get("principal")));
        if (!rotated) return c.json({ error: "automation not found" }, 404);
        return c.json({ secret: rotated.secret }, 200);
      } catch (err) {
        return automationError(c, err);
      }
    });

    app.put("/automations/:id", async (c) => {
      const id = c.req.param("id");
      if (!am.get(id)) return c.json({ error: "automation not found" }, 404);
      const body = await jsonObject(c);
      if (!body) return c.json({ error: "body must be a JSON object" }, 400);
      try {
        const automation = am.update(id, body, actorOf(c.get("principal")));
        if (!automation) return c.json({ error: "automation not found" }, 404);
        return c.json({ automation: publicAutomation(automation) }, 200);
      } catch (err) {
        return automationError(c, err);
      }
    });

    app.delete("/automations/:id", (c) => {
      if (!am.remove(c.req.param("id"), actorOf(c.get("principal")))) return c.json({ error: "automation not found" }, 404);
      return c.body(null, 204);
    });

    app.post("/automations/:id/run", (c) => {
      const id = c.req.param("id");
      if (!am.get(id)) return c.json({ error: "automation not found" }, 404);
      const result=am.runNow(id,actorOf(c.get("principal")));
      return c.json(result.started?result:{...result,error:result.reason},result.started?202:409);
    });
  }


  const appsMgr = deps.apps;
  if (appsMgr) {
    app.get("/apps", (c) => c.json(getDefaultRedactor().redact({ apps: appsMgr.list().map(app => appListing(app, c.get("principal").kind === "owner")), appsDir: appsMgr.appsDir })));
    // Everything that decides what code runs is OWNER-only: a paired device can look, never enable.
    const ownerOnly = (c: Context<AppEnv>) => (c.get("principal").kind === "owner" ? null : c.json({ error: "owner token required" }, 403));
    app.get("/apps/:id/review", (c) => {
      const denied = ownerOnly(c); if (denied) return denied;
      const app = appsMgr.list().find(app => app.id === c.req.param("id"));
      return app ? c.json(getDefaultRedactor().redact({ app })) : c.json({ error: "app not found" }, 404);
    });
    app.post("/apps/reload", (c) => {
      const denied = ownerOnly(c);
      if (denied) return denied;
      const apps = appsMgr.scan();
      ledger.append("_system", "owner", "config", { action: "apps_reloaded" });
      return c.json({ apps });
    });
    app.post("/apps/:id/enable", async (c) => {
      const denied = ownerOnly(c);
      if (denied) return denied;
      const body = (await c.req.json().catch(() => null)) as { hash?: unknown } | null;
      try {
        const info = appsMgr.enable(c.req.param("id"), typeof body?.hash === "string" ? body.hash : "");
        ledger.append("_system", "owner", "config", { action: "app_enabled", appId: info.id, hash: info.hash });
        return c.json({ app: info });
      } catch (err) {
        if (err instanceof AppsError) return c.json({ error: err.message }, 409);
        throw err;
      }
    });
    app.post("/apps/:id/disable", (c) => {
      const denied = ownerOnly(c);
      if (denied) return denied;
      try {
        const info = appsMgr.disable(c.req.param("id"));
        ledger.append("_system", "owner", "config", { action: "app_disabled", appId: info.id });
        return c.json({ app: info });
      } catch (err) {
        if (err instanceof AppsError) return c.json({ error: err.message }, 404);
        throw err;
      }
    });
  }

  const cu = deps.computer;
  if (cu) {
    const computerBusy = (c: Context<AppEnv>) => c.json({ error: "computer is busy" }, 409);
    // Lifecycle calls run in the background; their outcome lands in lastError on GET /computer.
    const startInBackground = (c: Context<AppEnv>, run: () => Promise<unknown>) => {
      if (cu.busy()) return computerBusy(c);
      void run().catch(() => undefined);
      return c.json({ started: true }, 202);
    };

    app.get("/computer", async (c) => {
      try {
        const router = "availability" in cu ? (cu as unknown as ComputerRouter) : undefined;
        const status = router ? await router.inspect() : { ...await cu.status(), capabilities: cu.capabilities() };
        return c.json({
          ...status,
          // Which backends exist and why one cannot start (never a secret), plus the one the setting asks for.
          backends: router?.availability() ?? [{ backend: status.backend, reason: null }],
          wantedBackend: getSetting(db, "computer").backend,
        });
      } catch (err) {
        return c.json({ error: err instanceof ComputerError ? err.message : "computer call failed" }, 502);
      }
    });

    app.post("/computer/backend/apply", (c) => {
      if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
      if (cu.busy()) return computerBusy(c);
      const router = "activeBackend" in cu ? cu as ComputerRouter : undefined;
      if (!router) return c.json({ error: "Backend switching is unavailable" }, 409);
      const backend = router.activeBackend();
      if (backend !== getSetting(db, "computer").backend) return c.json({ error: "Backend change is waiting for the computer to be idle and human control to end" }, 409);
      return c.json({ backend });
    });

    app.post("/computer/start", (c) => startInBackground(c, () => cu.start()));
    app.post("/computer/stop", (c) => startInBackground(c, () => cu.stop()));

    app.delete("/computer", (c) => {
      if (c.get("principal").kind !== "owner") return c.json({ error: "owner token required" }, 403);
      return startInBackground(c, () => cu.destroy());
    });

    const tk = deps.takeover;
    if (tk) {
      app.get("/computer/takeover", (c) => c.json(tk.state()));
      app.post("/computer/takeover", async (c) => {
        try {
          const { sessionId, link } = await tk.take(c.get("principal"));
          const secure = (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "")) === "https";
          c.header("cache-control", "no-store");
          if (link.kind === "external") {
            // Opened directly by the browser (no cookie, no proxy). The URL itself is the credential.
            return c.json({ viewPath: link.url, external: true, expiresAt: link.expiresAt });
          }
          c.header("set-cookie", viewCookie(sessionId, secure));
          return c.json({ viewPath: `${VIEW_PREFIX}/viewer/#${link.fragment}`, expiresAt: link.expiresAt });
        } catch (err) {
          if (err instanceof TakeoverError) return c.json({ error: err.message }, err.code === "failed" ? 502 : 409);
          return c.json({ error: "takeover failed" }, 502);
        }
      });
      app.post("/computer/handback", (c) => {
        if (!tk.releaseBy(c.get("principal"))) return c.json({ error: "only the device in control (or the owner) can hand back" }, 403);
        return c.json({});
      });
    }

    app.get("/computer/screenshot", async (c) => {
      if (cu.busy()) return c.json({ error: "computer is busy" }, 503);
      let shot: { path: string };
      try {
        shot = await cu.screenshot();
      } catch (err) {
        if (err instanceof ComputerError && err.message === NOT_RUNNING_MESSAGE) return c.json({ error: err.message }, 409);
        return c.json({ error: err instanceof ComputerError ? err.message : "computer call failed" }, 502);
      }
      const bytes = readFileSync(join(deps.dataDir ?? "", shot.path));
      return c.body(new Uint8Array(bytes), 200, { "content-type": "image/png", "cache-control": "no-store" });
    });
  }

  // Stored screenshots by file name only: a fixed name shape plus realpath containment blocks traversal and symlinks.
  const SCREEN_FILE_RE = /^\d{8}-\d{6}-\d{3}\.png$/;
  app.get("/computer/screens/:name", (c) => {
    const notFound = () => c.json({ error: "not found" }, 404);
    const name = c.req.param("name");
    if (!SCREEN_FILE_RE.test(name) || !deps.dataDir) return notFound();
    const realDir = tryRealpath(join(deps.dataDir, "computer", "screens"));
    const real = tryRealpath(join(deps.dataDir, "computer", "screens", name));
    if (!realDir || !real || !real.startsWith(realDir + sep)) return notFound();
    try {
      if (!statSync(real).isFile()) return notFound();
      const bytes = readFileSync(real);
      return c.body(new Uint8Array(bytes), 200, { "content-type": "image/png", "cache-control": "no-store" });
    } catch {
      return notFound();
    }
  });

  return app;
}

function tryRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * WebSocket /stream: pushes every ledger event. Token is passed as ?token= (browsers can't set headers).
 * Device sockets are tracked so a revocation closes them; owner sockets are not.
 */
export function attachStream(server: Server, ledger: Ledger, auth: Auth): () => void {
  const wss = new WebSocketServer({ noServer: true });
  const deviceSockets = new Map<string, Set<WebSocket>>();

  const onRevoke = (deviceId: string) => {
    const sockets = deviceSockets.get(deviceId);
    if (!sockets) return;
    deviceSockets.delete(deviceId);
    for (const ws of sockets) {
      ws.close(REVOKE_CLOSE_CODE, "revoked");
      const timer = setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      }, REVOKE_TERMINATE_MS);
      timer.unref();
      ws.once("close", () => clearTimeout(timer));
    }
  };
  const offRevoke = auth.onRevoke(onRevoke);

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/computer/view/")) return; // the view proxy owns these upgrades
    if (url.pathname !== "/stream") return socket.destroy();
    const token = url.searchParams.get("token");
    const principal = auth.authenticate(token);
    if (!principal) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // A revoke between authenticate() and the completed upgrade would otherwise leave this socket open untracked.
      if (principal.kind === "device" && !auth.authenticate(token)) {
        ws.close(REVOKE_CLOSE_CODE, "revoked");
        return;
      }
      const deviceId = principal.kind === "device" ? principal.deviceId : undefined;
      if (deviceId !== undefined) {
        const set = deviceSockets.get(deviceId) ?? new Set<WebSocket>();
        set.add(ws);
        deviceSockets.set(deviceId, set);
      }
      const off = ledger.subscribe("*", (e) => {if(!isPrivateExecutionRoom(e.roomId))ws.send(JSON.stringify(publicRequestEvent(e)));});
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        off();
        if (deviceId === undefined) return;
        const set = deviceSockets.get(deviceId);
        set?.delete(ws);
        if (set && set.size === 0) deviceSockets.delete(deviceId);
      };
      ws.on("close", cleanup);
      ws.on("error", cleanup);
    });
  };
  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
    offRevoke();
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
}
