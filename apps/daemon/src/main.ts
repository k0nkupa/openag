import {createPermissions} from './permissions.js';
import { createAvatarLibrary } from "./avatars.js";
import { createMcpInteractions } from "./mcp/interactions.js";
import {createResponsibilities,type Responsibilities} from "./responsibilities.js";
import {toExecutors} from "./tools/registry.js";
import { createSignInRoutes } from "./signin-routes.js";
import { resolveOwnerCredential } from "./owner-credential.js";
import { startOwnerAccess } from "./owner-access.js";
import { createBotModels } from "./botmodels.js";
import { serve } from "@hono/node-server";
import { createAuth } from "./auth.js";
import { createApprovals } from "./approvals.js";
import { openDb, resolveDataDir } from "./db/index.js";
import { attachStream, createGateway } from "./gateway.js";
import { commitMemory, ensureDataRepo } from "./datagit.js";
import { createLedger } from "./ledger.js";
import { createAcpRuntime } from "./runtimes/acp.js";
import { createApiRuntime } from "./runtimes/api.js";
import { createOllamaRuntime } from "./runtimes/ollama.js";
import { createRunner } from "./runtimes/runner.js";
import { createOllamaEmbedder, createVectorMemory } from "./vectors.js";
import { defaultTools } from "./runtimes/tools.js";
import { createScheduler } from "./scheduler.js";
import { registerHeartbeat } from "./heartbeat.js";
import { getSetting, resolveTimezone, setSetting } from "./settings.js";
import { registerPushNotifications, createPusher } from "./push.js";
import { getDefaultRedactor } from "./redact.js";
import { createWakeFilter } from "./wake.js";
import { registerBrief } from "./brief.js";
import { registerReflection } from "./reflection.js";
import { createReflectionApplier } from "./reflection-apply.js";
import { saveSkill, createSkillCatalogue } from "./skills.js";
import { createAutomationManager } from "./automations.js";
import { createHookHandler } from "./hooks.js";
import { createAppsManager } from "./apps.js";
import { createRoomRouter } from "./router.js";
import { createIngress } from "./ingress.js";
import { createSlackChannel } from "./slack.js";
import { createBackups, registerBackups } from "./backup.js";
import { createOps, registerOps } from "./ops.js";
import { createReadiness } from "./readiness.js";
import { ensureDefaultBot } from "./defaultbot.js";
import { createNtfySignaling, createRtcService, newRtcTopic, type RtcService } from "./rtc.js";
import { createMcpManager } from "./mcp.js";
import { createMcpSecrets } from "./mcp-secrets.js";
import { createMcpOAuth, type McpOAuth } from "./mcp-oauth.js";
import { createMcpServerService } from "./mcp-servers.js";
import { createMcpServerCheck } from "./mcp-check.js";
import { createMcpCommandReview } from "./mcp-command-review.js";
import { acpOfferedTools } from "./mcp-forwarding.js";
import { createResults } from "./results.js";
import { createAppleAccess } from "./apple-access.js";
import { createComposioConnect } from "./composio-connect.js";
import { createGoogleConnectors } from "./google-connectors.js";
import { createFirstPartyTools } from "./tools/firstparty.js";
import { createComputerBackends } from "./computer/backends.js";
import { createTakeover } from "./takeover.js";
import { createViewProxy } from "./computerview.js";
import { createMcpAccess, MCP_TOOL_NAMES } from "./mcpserver.js";
import type { Runner } from "./runtimes/runner.js";

const dataDir = resolveDataDir();
let token: string;
try { token = resolveOwnerCredential(dataDir, process.env.OPENAG_TOKEN); }
catch (err) { console.error(err instanceof Error ? err.message : "Owner credential setup failed"); process.exit(1); }

const db = openDb();
const ledger = createLedger(db);
ensureDefaultBot(db, ledger);
const approvals = createApprovals(db, ledger);
const mcpInteractions = createMcpInteractions(db,ledger);
mcpInteractions.recover();

await ensureDataRepo(dataDir).catch((err: unknown) => {
  console.error("data repo setup failed (memory commits disabled):", err instanceof Error ? err.message : String(err));
});
// Apps are owner-installed folders (apps.ts): nothing runs until the owner enables one, and only by the reviewed hash.
const apps = createAppsManager({
  dataDir,
  getEnabled: () => getSetting(db, "apps").enabled,
  setEnabled: (enabled) => void setSetting(db, "apps", { ...getSetting(db, "apps"), enabled }),
  getPaused: () => getSetting(db, "apps").paused,
  setPaused: (paused) => void setSetting(db, "apps", { ...getSetting(db, "apps"), paused }),
  // The ACP adapters list tools once per session: a changed tool set needs fresh sessions.
  onChange: () => { void acpRef.current?.invalidateSessions(); ledger.append("_system", "daemon", "config", { action: "apps_status_changed" }); },
});
const acpRef: { current?: { invalidateSessions(): Promise<void> } } = {};
apps.scan();
// MCP servers are optional: a bad config or a dead server never stops the daemon.
let localDeskOrigin: string | undefined;
const signInRoutes = createSignInRoutes({ localOrigin: () => localDeskOrigin, callbackOrigin: () => getSetting(db, "connectorSignIn").callbackOrigin });
const composio = createComposioConnect({ dataDir, prepareSignIn: signInRoutes, localOrigin: () => localDeskOrigin, getSignIn: () => getSetting(db, "connectorSignIn"),
  onChange: async () => { await mcp.reloadComposio(); },
  audit: action => ledger.append("_system", "user", "config", { action }),
});
const mcpSecrets = createMcpSecrets({ dataDir });
mcpSecrets.register();
const oauthRef: { current?: McpOAuth } = {};
const mcp = createMcpManager({ dataDir, composio, secrets: mcpSecrets, oauth: { connect: (cfg, entry, signal) => oauthRef.current!.connect(cfg, entry, signal) }, interactions:mcpInteractions, onChange: info => { if (info?.offeredChanged !== false) void acpRef.current?.invalidateSessions(); ledger.append("_system", "daemon", "config", { action: "mcp_status_changed" }); } });
const mcpOAuth = createMcpOAuth({
  dataDir, prepareSignIn: signInRoutes,
  entry: id => { try { const found = mcp.entries().servers.find(server => server.id === id); return found && found.origin === "custom" && found.transport === "http" && found.url && found.oauth ? { id, url: found.url, allowPrivateNetwork: found.allowPrivateNetwork === true, oauth: found.oauth } : undefined; } catch { return undefined; } },
  onChange: id => mcp.applyServer(id),
  audit: (action, id) => ledger.append("_system", "daemon", "config", { action, id }),
});
oauthRef.current = mcpOAuth;
const mcpServers = createMcpServerService({ dataDir, mcp, approvals, secrets: mcpSecrets, oauth: mcpOAuth });
const mcpCheck = createMcpServerCheck({ db, ledger, approvals, mcp });
const mcpCommandReview = createMcpCommandReview({ db, ledger, approvals, mcp, service: mcpServers });
await mcp.load().catch((err: unknown) => {
  console.error("mcp load failed:", err instanceof Error ? err.message : String(err));
});
const pusher = createPusher({ db });
// Created but never started here: the sandbox boots only when the owner asks for it.
// Late-bound: takeover needs the computer, and the computer must not switch backend while a human holds control.
const takeoverRef: { current?: import("./takeover.js").Takeover } = {};
const computer = createComputerBackends({
  dataDir,
  ledger,
  wanted: () => getSetting(db, "computer").backend,
  // No switching while a human holds control or while a computer action is waiting for approval (the approver saw THIS computer).
  switchBlocked: () =>
    takeoverRef.current?.state().active === true ||
    db.prepare("SELECT 1 FROM approvals WHERE status = 'pending' AND tool_name LIKE 'computer\\_%' ESCAPE '\\' LIMIT 1").get() !== undefined,
});
const apple = createAppleAccess({ dataDir, mcp, audit: (action, app) => ledger.append("_system", "user", "config", { action, app }) });
const google = createGoogleConnectors({ dataDir, onChange: () => { void acpRef.current?.invalidateSessions(); }, audit: (action, fields) => ledger.append("_system", "user", "config", { action, ...fields }) });
const skills = createSkillCatalogue(db, dataDir);
const avatarLibrary = createAvatarLibrary(db, ledger);
const permissions=createPermissions(db,ledger,dataDir,approvals);
const firstParty = createFirstPartyTools({ avatars: avatarLibrary, db, skills, computer, pusher, google, results: createResults(db, ledger) });
// Both native adapters receive the daemon-gated first-party and App contracts and the MCP servers the owner has switched on for agents: custom servers, the Apple
// package and Composio (never the built-in example). Forwarding offers a tool; every call still goes through the daemon's gate,
// where a custom tool defaults to act-external and asks unless the owner has reclassified it.
const MCP_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(MCP_TOOL_NAMES);
// The access needs the runner (to find active turns) and the runner needs the ACP runtime, so the runner is set after.
const runnerRef: { current?: Runner } = {};
const mcpToolDefs = () => acpOfferedTools({ mcp, firstPartyDefs: firstParty.defs, firstPartyAllowed: MCP_TOOL_ALLOWLIST, appDefs: apps.toolDefs() });
const mcpAccess = createMcpAccess({
  runner: { activeTurn: (botId, roomId) => runnerRef.current?.activeTurn(botId, roomId) },
  dataDir,
  tools: mcpToolDefs,
});
// Auto-allow only these own-server tools in ACP; the daemon still applies its authoritative gate.
const mcpToolAllowed = { has: (name: string) => mcpToolDefs().some(d => d.name === name), values: () => mcpToolDefs().map(d => d.name) };
const acp = createAcpRuntime({
  dataDir,
  mcp: { access: mcpAccess, baseUrl: () => `http://127.0.0.1:${port}`, tools: mcpToolAllowed },
});
acpRef.current = acp;
const vectors =
  process.env.OPENAG_EMBED === "off" ? undefined : createVectorMemory({ db, embedder: createOllamaEmbedder() });
const responsibilitiesRef:{current?:Responsibilities}={};
const investigationDefs=()=>responsibilitiesRef.current?[responsibilitiesRef.current.tool]:[];
const runner = createRunner({
  permissions,
  skills,
  capabilityGuidance: firstParty.capabilityGuidance,
  db,
  ledger,
  approvals,
  dataDir,
  runtimes: {
    api: createApiRuntime({
      capabilities: model => botModels.catalogue.capabilities(model),
      toolDefs: () => [...firstParty.defs, ...mcp.toolDefs(), ...apps.toolDefs(),...investigationDefs()],
      ollama: createOllamaRuntime({ toolDefs: () => [...firstParty.defs, ...mcp.toolDefs(), ...apps.toolDefs(),...investigationDefs()] }),
    }),
    acp,
  },
  tools: defaultTools,
  dynamicTools: () => ({ ...firstParty.executors, ...mcp.executors(), ...apps.executors(),...toExecutors(investigationDefs()) }),
  vectors,
});
runnerRef.current = runner;
if (vectors) {
  // Chunks left pending by an Ollama outage are retried on a timer, not only after the next turn.
  void vectors.embedPending();
  setInterval(() => void vectors.embedPending(), 5 * 60 * 1000).unref();
}

const scheduler = createScheduler();
const tz = resolveTimezone();
const backups = createBackups({ db, dataDir, ledger, tz });
registerBackups({ db, dataDir, scheduler, backups, tz });
const ops = createOps({ db, dataDir });
registerOps({ scheduler, ops });
const pushTopic = getSetting(db, "push").topic;
if (pushTopic) getDefaultRedactor().addSecret(pushTopic);
// Push is best effort: a failed notification must never reach the ledger or a turn.
registerPushNotifications(ledger, pusher);
const wake = createWakeFilter({
  db,
  ledger,
  tz,
  onPing: (d) => void pusher.notifyPing(d),
});
registerHeartbeat({ db, ledger, runner, scheduler, tz, wake });
registerBrief({ db, ledger, scheduler, tz,readableScopes:()=>responsibilitiesRef.current?.readableScopes()??[] });
const reflection = registerReflection({ db, ledger, approvals, runner, scheduler, tz, dataDir, skillsEnabled: true });
// Applies approved skills and legacy memory approvals; new reflection memory saves in reflection.ts.
const reflectionApplier = createReflectionApplier({
  ledger,
  approvals,
  dataDir,
  // SkillError propagates: the applier records it as an error event and nothing is half-written.
  saveSkill: async (botId, skill) => {
    saveSkill(dataDir, botId, skill);
    await commitMemory(dataDir, `skills: reflection apply ${skill.slug} (${botId})`);
  },
});
const responsibilities=createResponsibilities({db,ledger,runner,wake});
responsibilitiesRef.current=responsibilities;
const automations = createAutomationManager({ db, ledger, runner, scheduler, wake, tz });
automations.sync();
// Rejections are audited at most once a minute, with a short reason only (never the secret, body or slug).
let lastHookRejectAudit = Number.NEGATIVE_INFINITY;
const hooks = createHookHandler({
  lookup: (slug) => automations.hookTarget(slug),
  fire: (target, input) => automations.fireHook(target, input),
  onRejected: (reason) => {
    const t = Date.now();
    if (t - lastHookRejectAudit < 60_000) return;
    lastHookRejectAudit = t;
    ledger.append("_system", "system", "config", { action: "hook_rejected", reason });
  },
});
scheduler.start();

const interrupted = runner.recover();
responsibilities.recover();
if (interrupted > 0) console.log(`marked ${interrupted} running turn(s) as interrupted`);

const auth = createAuth({ db, ownerToken: token });
const takeover = createTakeover({ computer, ledger });
takeoverRef.current = takeover;
// An external live-view link cannot be revoked, so revoking its holder ends the hosted session that backs it.
takeover.onRelease((reason, external) => {
  if (reason === "revoked" && external) void computer.destroy().catch(() => undefined);
});
const viewProxy = createViewProxy({ takeover });
auth.onRevoke((deviceId) => { takeover.releaseIfHeldBy(deviceId, "revoked"); composio.revokeDevice(deviceId); mcpOAuth.revokeDevice(deviceId); });
const botModels = createBotModels({ db, ledger, acp, withIdleBot: runner.withIdleBot });
const roomRouter = createRoomRouter({ db, catalogue: botModels.catalogue });
const slack = createSlackChannel({ db, ledger, ingress: createIngress({ ledger, dispatch: runner.dispatch, router: roomRouter }) });
slack.reload();
const rtcRef: { current?: RtcService } = {};
if (process.env.OPENAG_RTC_TURN_SECRET) getDefaultRedactor().addSecret(process.env.OPENAG_RTC_TURN_SECRET);
const rtcTopic = getSetting(db, "rtc").topic;
if (rtcTopic) getDefaultRedactor().addSecret(rtcTopic);
const readiness = createReadiness({ db, ledger, auth, backups, ops });
void botModels.catalogue.refresh(true).catch(() => console.error("model catalogue background refresh failed; last successful metadata retained"));
scheduler.register({ id: "model-catalogue", schedule: { everyMs: () => 60 * 60 * 1000 }, run: async () => { await botModels.catalogue.refresh(true); } });
const app = createGateway({
  permissions,
  skills,
  skillsChanged: () => acp.invalidateSessions(),
  mcpInteractions,
  responsibilities,
  botModels,
  google,
  composio,
  apple,
  vectors,
  db,
  hooks,
  ledger,
  approvals,
  auth,
  dispatch: runner.dispatch,
  work: runner.work,
  cancelWork: runner.cancelWork,
  agentRequests: runner.agentRequests,
  tz,
  automations,
  push: pusher,
  mcp,
  apps,
  router: roomRouter,
  slack,
  backups,
  ops,
  readiness,
  rtc: {
    reload: () => rtcRef.current?.reload(),
    createInvite: () => rtcRef.current?.createInvite() ?? { secret: "", expiresAt: 0 },
    status: () => rtcRef.current?.status() ?? { enabled: false, turn: false, inert: "starting", subscribed: false, peers: 0, offers: 0, rejected: 0, lastError: null },
  },
  computer,
  dataDir,
  mcpAccess,
  mcpServers,
  mcpCheck,
  mcpCommandReview,
  mcpOAuth,
  takeover,
  viewProxy,
  reflection,
});

// Late-bound: the peers call the gateway itself, so the service needs the finished app.
rtcRef.current = createRtcService({
  db,
  ledger,
  auth,
  fetch: (req) => Promise.resolve(app.fetch(req)),
  signaling: (cfg) => createNtfySignaling(cfg),
  // A revoked device knew the signaling topic: a new one locks it out (paired devices pick the new one up from their next invite).
  onRevoke: () => {
    const cfg = getSetting(db, "rtc");
    if (!cfg.enabled || !cfg.topic) return;
    const topic = newRtcTopic();
    setSetting(db, "rtc", { ...cfg, topic });
    getDefaultRedactor().addSecret(topic);
    ledger.append("_system", "daemon", "config", { action: "rtc_topic_rotated", reason: "device revoked" });
    rtcRef.current?.reload();
  },
});
rtcRef.current.reload();

const port = Number(process.env.OPENAG_PORT ?? 4747);
// Loopback by default; OPENAG_HOST=0.0.0.0 opts into LAN access. Only addresses that still serve 127.0.0.1 are accepted (owner access and the local desk origin use it).
const host = process.env.OPENAG_HOST ?? "127.0.0.1";
if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw Error("OPENAG_HOST must be 127.0.0.1 or 0.0.0.0");
const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`openagd listening on http://${host}:${info.port}`);
});
await new Promise<void>((resolve, reject) => { server.once("error", reject); if (server.listening) resolve(); else server.once("listening", resolve); });
const address = server.address();
if (!address || typeof address === "string") throw Error("Daemon has no TCP port");
localDeskOrigin = `http://127.0.0.1:${address.port}`;
const stopOwnerAccess = await startOwnerAccess(dataDir, address.port, auth, ledger);
console.log("Open this desk with pnpm desk:open on the daemon host.");
const detachStream = attachStream(server as import("node:http").Server, ledger, auth);
const detachView = viewProxy.attach(server as import("node:http").Server);

let stopping: Promise<void> | undefined;
function shutdown(): Promise<void> {
  return stopping ??= stop();
}

async function stop(): Promise<void> {
  // Storage stays open until every admitted job and existing resource owner settles.
  const deadline = setTimeout(() => {
    console.error("openagd forced stop: shutdown incomplete after 20 seconds; Interrupted/Unknown records retained");
    process.exit(1);
  }, 20_000);
  try {
    scheduler.stop();
    runner.shutdown();
    stopOwnerAccess();
    detachStream();
    slack.stop();
    rtcRef.current?.stop();
    detachView();
    takeover.dispose();
    const serverClosed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    responsibilities.shutdown();
    automations.shutdown();
    mcpInteractions.close();
    mcpCheck.dispose();
    mcpCommandReview.dispose();
    mcpAccess.revokeAll();
    google.close();
    const hostedRelease = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([computer.releaseHosted(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error("hosted release unconfirmed")), 5000); })]); }
      finally { clearTimeout(timer); }
    })();
    const results = await Promise.allSettled([
      serverClosed.then(async () => { await reflection.idle(); await reflectionApplier.idle(); }),
      runner.drain(), responsibilities.idle(), automations.idle(), mcpCheck.idle(), mcpCommandReview.idle(),
      botModels.catalogue.close(), acp.close(), composio.close(), mcpOAuth.close(), mcp.close(), hostedRelease,
    ]);
    const incomplete = results.some(result => result.status === "rejected");
    reflectionApplier.dispose();
    db.close();
    console[incomplete ? "error" : "log"](incomplete ? "openagd incomplete stop: an owner failed cleanup; remote release may be unconfirmed" : "openagd stopped: execution drained");
    clearTimeout(deadline);
    process.exit(incomplete ? 1 : 0);
  } catch {
    console.error("openagd incomplete stop: shutdown setup failed; waiting for the shutdown deadline");
  }
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
