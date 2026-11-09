import type { RequestPage } from './types';
import type { DictationStatus } from "./types";
import type {PermissionAdoption} from './types';
import type { PermissionPreset,PermissionDefault,PermissionSession } from './types';
import type {SchedulePreviewInput, SchedulePreview} from "./types";
import type {McpInteraction} from "./types";
import type {ResponsibilityConfig,Responsibility,ResponsibilityList,Investigation} from "./types";
import type { BotModelState, ModelChoices, ModelTarget, Reasoning, RoutingInput } from "./types";
import type { AutomationRun, WorkQuestion, ConversationRequest,
  ActionReceipt,
  SavedResult,
  ResultQuery,
  Attachment,
  Approval,
  BotInfo,
  Decision,
  DaemonSettings,
  Health,
  LedgerEvent,
  Room,
  WakeDecision,
  BriefResult,
  DigestItem,
  Automation,
  AutomationInput,
  CreateAutomationResult,
  PushStatus,
  PushTestResult,
  BotMemory,
  BotSettings,
  MemoryHit,
  ModelsStatus,
  McpStatus,
  McpServerChange,
  McpServerInput,
  McpSecretView,
  McpOAuthStatus,
  McpCommandInput,
  McpCommandReviewDisplay,
  McpCommandReviewState,
  McpCheckState,
  ComputerBackend,
  ComputerStatus,
  TakeoverStatus,
  TakeoverGrant,
  ReflectionStatus,
  Skill,
  SkillSummary,
  AppInfo,
  LibraryInventory,
  ConnectorStatus,
  ComposioStatus,
  SetupReview,
  RouterOption,
  RouterStrategy,
  SlackSettings,
  SlackStatus,
  RtcInvite,
  RtcSettings,
  RtcStatus,
  BackupStatus,
  BackupRunResult,
  OpsStatus,
  Readiness,
  ReadinessApplyResult,
} from "./types";
import type { WorkItem, WorkRun, WorkApproval, WorkQuery } from "./types";
import { clearOwnerToken, getOwnerToken } from "./ownerSession";

export class ApiError extends Error {
  readonly status: number;
  /** Seconds, from a Retry-After header on a 429. */
  readonly retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  /** 'owner' or the id of the device whose pairing code created this one. */
  createdBy: string;
  /** 'full' devices act as the owner; 'limited' ones cannot use owner-only routes. */
  access: DeviceAccess;
  current: boolean;
}

export type DeviceAccess = "limited" | "full";

export type Whoami = { kind: "owner" } | { kind: "device"; deviceId: string; name: string; access?: DeviceAccess };

export interface PairingCode {
  code: string;
  expiresAt: number;
}

export interface Api {
  getRequestManifests(turnId:string,before?:number):Promise<RequestPage>;
  getMcpInteraction(id:string):Promise<{interaction:McpInteraction}>;
  respondMcpInteraction(id:string,revision:string,action:"accept"|"decline"|"cancel",content?:Record<string,unknown>):Promise<{interaction:McpInteraction}>;
  listResults(query?: ResultQuery): Promise<{ results: SavedResult[]; nextCursor: number | null }>;
  getResult(id: string, version?: number): Promise<{ result: SavedResult; content: string }>;
  getResultVersions(id: string, before?: number): Promise<{ results: SavedResult[]; nextCursor: number | null }>;
  downloadResult(id: string, version: number): Promise<Blob>;
  listWork(query?: WorkQuery): Promise<{ work: WorkItem[]; nextCursor: number | null }>;
  getWork(id: string): Promise<{ work: WorkItem }>;
  getWorkRuns(id: string, before?: number): Promise<{ runs: WorkRun[]; nextCursor: number | null }>;
  getWorkActivity(id: string, before?: number, after?: number): Promise<{ events: LedgerEvent[]; nextCursor: number | null }>;
  getWorkApprovals(id: string, before?: number): Promise<{ approvals: WorkApproval[]; nextCursor: number | null }>;
  startWork(id: string, revision: number): Promise<{ work: WorkItem }>;
  cancelWork(id: string, revision: number): Promise<{ work: WorkItem }>;
  listRooms(): Promise<{ rooms: Room[] }>;
  createRoom(input: { id: string; name: string; members: string[]; kind?: "room" | "direct"; lead?: string; requestId?: string }): Promise<{ room: Room; created: boolean }>;
  roomCreationStatus(requestId: string): Promise<{ room: Room | null }>;
  getRoom(id: string): Promise<{ room: Room; bots: BotInfo[] }>;
  getModelCatalogue(): Promise<import("./types").ModelCatalogueStatus>;
  refreshModelCatalogue(): Promise<import("./types").ModelCatalogueStatus>;
  botCreationTargets(): Promise<{ targets: Array<{ id: string; name: string; configured?: boolean }> }>;
  discoverBotCreation(input: { requestId: string; target: string; model?: string }): Promise<ModelChoices>;
  botCreationStatus(requestId: string): Promise<{ bot: BotInfo | null }>;
  createBot(input: { requestId: string; name: string; description: string; instructions: string; target: string; model: string; snapshotId: string; reasoning: Reasoning }): Promise<{ bot: BotInfo; created: boolean }>;
  listBots(): Promise<{ bots: BotInfo[] }>;
  /** Owner only (the desk retries with the in-memory owner token). */
  getBotModel(id: string): Promise<BotModelState>;
  discoverBotModel(id: string, input: { target: ModelTarget; model?: string }): Promise<ModelChoices>;
  putBotModel(id: string, input: { revision: string; snapshotId: string; model: string; reasoning: Reasoning }): Promise<BotModelState>;
  getAvatarLibrary(): Promise<{ avatars: import("./avatar-library").LibraryAvatar[] }>;
  getBotSettings(id: string): Promise<BotSettings>;
  /** Text fields need the owner; an avatar-only change works from any paired device. `avatar: null` resets it. */
  putBotSettings(id: string, patch: Partial<Pick<BotSettings, "name" | "description" | "instructions" | "avatar" | "maxSteps">>): Promise<{ bot: BotInfo }>;
  listEvents(roomId: string, after?: number): Promise<{ events: LedgerEvent[] }>;
  getAgentRequestManifests(roomId:string,id:string,before?:number):Promise<RequestPage>;
  agentRequests(roomId:string):Promise<{requests:import('./types').AgentRequest[]}>;
  cancelAgentRequest(roomId:string,id:string):Promise<{request:import('./types').AgentRequest}>;
  sendMessage(roomId: string, text: string, attachments?: string[], replyToMessageId?: number, replyToQuestion?:{id:string;revision:number}): Promise<unknown>;
  getDictation(): Promise<DictationStatus>;
  transcribe(roomId: string, audio: Blob, target: string, signal: AbortSignal): Promise<{ text: string }>;
  uploadAttachment(roomId: string, file: File): Promise<{ attachment: Attachment }>;
  removeAttachment(roomId: string, id: string): Promise<unknown>;
  downloadAttachment(roomId: string, id: string): Promise<Blob>;
  listPending(): Promise<{ approvals: Approval[] }>;
  inspectReceipt(id:string,input:{reviewVersion:string;note:string;reference:string}):Promise<{receipt:ActionReceipt}>;
  getApproval(id: string): Promise<{approval:Approval|null;receipt:ActionReceipt|null}>;
  conversationRequests(roomId:string,before?:string):Promise<{requests:ConversationRequest[];nextCursor:string|null}>;
  getQuestion(id:string):Promise<{question:WorkQuestion}>;
  answerQuestion(id:string,revision:number,answer:string):Promise<{question:WorkQuestion}>;
  getWorkReceipts(id:string,before?:number):Promise<{receipts:ActionReceipt[];nextCursor:number|null}>;
  decide(id: string, decision: Decision): Promise<{ approval: Approval }>;
  health(): Promise<Health>;
  getPermissions(botId:string,roomId:string):Promise<PermissionSession>;
  setPermissions(botId:string,roomId:string,preset:PermissionPreset,revision:number,acknowledgeFullAccess:boolean):Promise<PermissionSession>;
  getPermissionAdoption():Promise<PermissionAdoption>;
  adoptPermissions(preset:PermissionPreset,reviewVersion:string,acknowledgeFullAccess:boolean):Promise<PermissionAdoption>;
  getPermissionDefault():Promise<PermissionDefault>;
  setPermissionDefault(preset:PermissionPreset,revision:number,acknowledgeFullAccess:boolean):Promise<PermissionDefault>;
  whoami(signal?: AbortSignal): Promise<Whoami>;
  listDevices(): Promise<{ devices: Device[] }>;
  /** Full access needs the owner. Defaults to limited. */
  createPairingCode(access?: DeviceAccess): Promise<PairingCode>;
  /** Owner only. */
  setDeviceAccess(id: string, access: DeviceAccess): Promise<{ id: string; access: DeviceAccess }>;
  revokeDevice(id: string, opts?: { cascade?: boolean }): Promise<void>;
  /** Owner token only. Returns the new device's token, which is the only credential the caller should keep. */
  createDevice(name: string, access?: DeviceAccess): Promise<{ device: Device; token: string }>;
  getSettings(): Promise<{ settings: DaemonSettings }>;
  /** Validation errors come back as ApiError with the daemon's message. */
  putSetting(key: keyof DaemonSettings, value: unknown): Promise<{ key: string; value: unknown }>;
  getModelsStatus(): Promise<ModelsStatus>;
  getBotMemory(id: string): Promise<BotMemory>;
  /** Owner only. Secrets are removed on save. */
  putBotMemory(id: string, text: string): Promise<{ botId: string; text: string }>;
  /** 503 ApiError when embeddings are not available. */
  searchMemory(bot: string, q: string): Promise<{ results: MemoryHit[] }>;
  getWakeDecisions(limit?: number): Promise<{ decisions: WakeDecision[] }>;
  /** Records "should have pinged" for a held-back ping. Review only; it does not change the filter. */
  sendWakeFeedback(id: number): Promise<{ id: number; feedback: "should_have_pinged" }>;
  getDigest(): Promise<{ items: DigestItem[] }>;
  /** Sends the morning brief now, ignoring its schedule. */
  sendBriefNow(): Promise<BriefResult>;
  listResponsibilities():Promise<ResponsibilityList>;
  createResponsibility(input:ResponsibilityConfig):Promise<{responsibility:Responsibility}>;
  updateResponsibility(id:string,patch:Partial<ResponsibilityConfig>&{baseRevision:number;enabled?:boolean}):Promise<{responsibility:Responsibility}>;
  responsibilityHistory(id:string):Promise<{investigations:Investigation[]}>;
  previewAutomationSchedule(input: SchedulePreviewInput, signal?: AbortSignal): Promise<SchedulePreview>;
  listAutomations(): Promise<{ automations: Automation[] }>;
  /** `secret` in the result is present only for a generated webhook secret, shown once. A github_poll create never returns a token. */
  createAutomation(input: AutomationInput): Promise<CreateAutomationResult>;
  /** Partial update. Never returns a secret. Validation errors come back as ApiError with the daemon's message. */
  updateAutomation(id: string, patch: Partial<AutomationInput>): Promise<{ automation: Automation }>;
  /** Webhook kind only. Replaces the secret; the new one is returned once. */
  rotateAutomationSecret(id: string): Promise<{ secret: string }>;
  deleteAutomation(id: string): Promise<void>;
  /** Starts a run in the background; the outcome shows up in the automation's lastStatus. */
  runAutomation(id: string): Promise<{ started: boolean;runId?:string;reason?:string }>;
  listAutomationRuns(automationId?:string,before?:number):Promise<{runs:AutomationRun[];nextCursor:number|null}>;
  getAutomationRun(id:string):Promise<{run:AutomationRun}>;
  /** Creates a new secret topic and replaces the old one. Returns the topic once. */
  generatePushTopic(): Promise<{ topic: string }>;
  /** 409 ApiError when push is disabled or has no topic. */
  sendPushTest(): Promise<PushTestResult>;
  getPushStatus(): Promise<PushStatus>;
  /** MCP server status; the owner also gets the editable entries and the file digest. */
  getMcpServers(): Promise<McpStatus>;
  /** Re-reads mcp.json and reconnects. Returns the same shape as getMcpServers. */
  reloadMcp(): Promise<McpStatus>;
  /** Owner only. Adds a custom remote server (409 when the id exists or the file changed since `digest`). */
  addMcpServer(id: string, input: McpServerInput, digest?: string): Promise<McpServerChange>;
  /** Owner only. Changes any subset of fields; `digest` is required and a stale one is a 409. */
  updateMcpServer(id: string, input: Partial<McpServerInput>, digest: string): Promise<McpServerChange>;
  removeMcpServer(id: string, digest: string): Promise<McpServerChange>;
  /** Owner only. Proposes a server check; returns the approval to decide. Nothing is contacted until it is accepted. */
  checkMcpServer(input: McpServerInput & { id?: string }): Promise<{ approvalId: string; expiresInMs: number }>;
  getMcpCheck(approvalId: string): Promise<McpCheckState>;
  /** OAuth sign-in for one custom server. Responses never carry a token. */
  getMcpOAuth(serverId: string, signal?: AbortSignal): Promise<McpOAuthStatus>;
  mcpOAuth(serverId: string, action: "start" | "status" | "cancel" | "disconnect", body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  setMcpOAuthClient(serverId: string, clientId: string, clientSecret?: string): Promise<{ ok: true }>;
  removeMcpOAuthClient(serverId: string): Promise<{ ok: true }>;
  /** Proposes a local command for review; nothing is written or started until the returned approval is accepted. */
  proposeMcpCommand(input: McpCommandInput): Promise<{ approvalId: string; expiresInMs: number; review: McpCommandReviewDisplay; replaces: boolean }>;
  getMcpCommandReview(approvalId: string): Promise<McpCommandReviewState>;
  /** Direct secrets are write-only: the list holds names and the last four characters, never a value. */
  getMcpSecrets(): Promise<{ secrets: McpSecretView[] }>;
  setMcpSecret(serverId: string, name: string, value: string, origin?: string): Promise<{ secret: McpSecretView }>;
  removeMcpSecret(serverId: string, name: string): Promise<{ ok: true }>;
  getComputer(): Promise<ComputerStatus>;
  /** Saves `computer.backend`. Takes effect on the next computer call; 400 ApiError for an unknown kind. */
  putComputerBackend(backend: ComputerBackend): Promise<{ key: string; value: unknown }>;
  applyComputerBackend(): Promise<{ backend: ComputerBackend }>;
  /** Accepted (202) and run in the background; poll getComputer for the outcome. 409 ApiError when busy. */
  startComputer(): Promise<{ started: boolean }>;
  stopComputer(): Promise<{ started: boolean }>;
  /** Owner token only (403 for a device). */
  destroyComputer(): Promise<{ started: boolean }>;
  /** A fresh PNG. 409 when not running, 503 when busy. */
  computerScreenshot(): Promise<Blob>;
  getTakeover(): Promise<TakeoverStatus>;
  /** 409 ApiError when someone else holds control or the computer is not running. Sets a cookie; the caller opens viewPath. */
  takeControl(): Promise<TakeoverGrant>;
  handBack(): Promise<unknown>;
  getReflection(): Promise<ReflectionStatus>;
  /** Starts a run in the background (202). 409 ApiError when a run is already in progress. */
  runReflection(): Promise<{ started: boolean }>;
  /** Read-only. Skills are saved by bots (approved in the Inbox) or edited on disk. */
  listSkills(botId: string): Promise<{ skills: SkillSummary[] }>;
  /** 404 ApiError for an unknown slug. */
  getSkill(botId: string, slug: string): Promise<{ skill: Skill }>;
  getSkillLibrary(): Promise<{ enabled: boolean; source: string; note: string }>;
  setSkillLibrary(enabled: boolean): Promise<{ enabled: boolean }>;
  getSkillCatalogue(botId: string): Promise<{ skills: SkillSummary[] }>;
  assignSkills(botId: string, ids: string[]): Promise<{ skills: SkillSummary[] }>;
  inspectSkill(botId: string, id: string): Promise<{ skill: Skill }>;
  /** Read-only listing of the Apps folder. Any device may read it. */
  getSetupReview(id: string): Promise<SetupReview>;
  getAppLibrary(): Promise<LibraryInventory>;
  getConnectors(): Promise<ConnectorStatus>;
  getComposio(signal?: AbortSignal): Promise<ComposioStatus>;
  composioConnector(action: "start" | "complete" | "disconnect" | "status" | "cancel", body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  googleConnector(action: "start" | "complete" | "pause" | "verify" | "disconnect", body: Record<string, unknown>): Promise<Record<string, unknown>>;
  appleConnector(action: "permission" | "verify", app: string): Promise<Record<string, unknown>>;
  listApps(): Promise<{ apps: AppInfo[]; appsDir: string }>;
  /** Owner only (403 ApiError for a device). Rescans the folder. */
  reloadApps(): Promise<{ apps: AppInfo[] }>;
  /** Owner only. `hash` must be the hash the owner reviewed; 409 ApiError when the manifest changed since. */
  reviewApp(id: string): Promise<{ app: AppInfo }>;
  enableApp(id: string, hash: string): Promise<{ app: AppInfo }>;
  /** Owner only (403 ApiError for a device). */
  disableApp(id: string): Promise<{ app: AppInfo }>;
  /** Lists each routing strategy and whether it is usable (reason null) or not (reason says why). */
  getRouterStrategies(): Promise<{ strategies: RouterOption[] }>;
  /** Owner only (403 ApiError for a device). 400 for an unknown strategy, 409 ApiError with the reason when the strategy is not available. */
  setRoomRouter(roomId: string, strategy: RouterStrategy): Promise<{ room: Room }>;
  setRoomRouting(roomId: string, input: RoutingInput): Promise<{ room: Room }>;
  /** Owner only (403 ApiError for a device). 400 ApiError with the daemon's message for an invalid name or a lead who is not a member. */
  updateRoom(roomId: string, patch: { name?: string; description?: string; leadBotId?: string; addMembers?: string[] }): Promise<{ room: Room }>;
  discoverRoomRouter(roomId: string, input: { strategy: RouterStrategy; provider: string; model?: string }): Promise<ModelChoices>;
  /** Read-only Slack bridge status. */
  getSlackStatus(): Promise<SlackStatus>;
  /** Owner only (403 ApiError for a device). 400 ApiError with the daemon's message for invalid ids. Settings are saved via the settings API. */
  putSlack(value: SlackSettings): Promise<{ key: string; value: unknown }>;
  getRtcStatus(): Promise<RtcStatus>;
  createRtcInvite(): Promise<RtcInvite>;
  generateRtcTopic(): Promise<{ rtc: RtcSettings }>;
  putRtc(value: RtcSettings): Promise<{ key: string; value: unknown }>;
  getBackups(): Promise<BackupStatus>;
  /** Owner only (403 ApiError for a device). A failed backup is a 500 ApiError carrying the daemon's error text. */
  runBackup(): Promise<BackupRunResult>;
  getOps(): Promise<OpsStatus>;
  /** Always-on readiness checklist (read-only). */
  getReadiness(): Promise<Readiness>;
  /** Owner only (403 ApiError for a device). Switches on the recommended heartbeat, reflection and brief settings. */
  applyReadiness(): Promise<ReadinessApplyResult>;
}

/** Maps a failed response to ApiError. The owner-only refusal gets the unlock hint appended. */
function apiErrorFrom(data: unknown, status: number): ApiError {
  const serverMessage = errorTextOf(data);
  if (serverMessage === OWNER_REQUIRED) return new ApiError(`${serverMessage}.${OWNER_HINT}`, status);
  return new ApiError(serverMessage ?? `Request failed (${status})`, status);
}

/** Checks a candidate token against GET /whoami without touching the held owner token. Rejects with ApiError. */
export async function whoamiWithToken(candidate: string, fetchImpl: typeof fetch = fetch): Promise<Whoami> {
  let res: Response;
  try {
    res = await fetchImpl("/whoami", { headers: { authorization: `Bearer ${candidate}` } });
  } catch {
    throw new ApiError("Cannot reach the daemon", 0);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw apiErrorFrom(data, res.status);
  return data as Whoami;
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

const OWNER_REQUIRED = "owner token required";
const OWNER_HINT = " Full access is required. Ask a trusted Full access device, or run pnpm desk:open on the daemon host.";

export interface ApiOptions {
  /**
   * When true (default), an owner-only refusal is retried once with the owner token held in memory (ownerSession).
   * Pass false over WebRTC: the daemon refuses the owner token there.
   */
  ownerRetry?: boolean;
}

/** The daemon's `error` string from a JSON body, or null. */
function errorTextOf(data: unknown): string | null {
  return data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : null;
}

/** Every call is Bearer-authenticated except health. A 401 signs the caller out via onUnauthorized. */
export function createApi(
  token: string,
  onUnauthorized: () => void,
  fetchImpl: typeof fetch = fetch,
  options: ApiOptions = {},
): Api {
  const ownerRetry = options.ownerRetry !== false;

  /**
   * One request. For an authed call refused with "owner token required" while an owner token is held, retries
   * exactly this request once with that token. A 401 on the retry means the held token is wrong: it is cleared.
   */
  async function send(path: string, method: string, headers: Record<string, string>, body: BodyInit | undefined, auth: boolean, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(path, { method, headers, body, ...(signal ? { signal } : {}) });
    } catch (err) {
      if (err instanceof TypeError && (err.message.startsWith("rtc fetch: attachments") || err.message.startsWith("rtc fetch: dictation"))) throw new ApiError(err.message.slice(11), 409);
      throw new ApiError("Cannot reach the daemon", 0);
    }
    if (!auth || !ownerRetry || res.status !== 403) return res;
    const held = getOwnerToken();
    if (held === null) return res;
    const text = await res.clone().text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (errorTextOf(parsed) !== OWNER_REQUIRED) return res;
    let retry: Response;
    try {
      retry = await fetchImpl(path, { method, headers: { ...headers, authorization: `Bearer ${held}` }, body, ...(signal ? { signal } : {}) });
    } catch {
      throw new ApiError("Cannot reach the daemon", 0);
    }
    if (retry.status === 401) {
      clearOwnerToken();
      return res;
    }
    return retry;
  }

  /** Binary GET with the same auth and error mapping as request(). */
  async function requestBlob(path: string): Promise<Blob> {
    const res = await send(path, "GET", { authorization: `Bearer ${token}` }, undefined, true);
    if (res.status === 401) {
      onUnauthorized();
      throw new ApiError("Token rejected", 401);
    }
    if (!res.ok) {
      const data: unknown = await res.json().catch(() => null);
      throw apiErrorFrom(data, res.status);
    }
    return res.blob();
  }

  async function request<T>(method: string, path: string, body?: unknown, auth = true, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {};
    if (auth) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await send(path, method, headers, body === undefined ? undefined : JSON.stringify(body), auth, signal);
    if (signal?.aborted) throw new ApiError("Request cancelled or timed out", 0);
    if (auth && res.status === 401) {
      onUnauthorized();
      throw new ApiError("Token rejected", 401);
    }
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) throw apiErrorFrom(data, res.status);
    if (signal?.aborted) throw new ApiError("Request cancelled or timed out", 0);
    return data as T;
  }

  const withQuery = (path: string, query: object) => {
    const params = new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])).toString();
    return params ? `${path}?${params}` : path;
  };
  const roomPath = (id: string) => `/rooms/${encodeURIComponent(id)}`;
  const automationPath = (id: string) => `/automations/${encodeURIComponent(id)}`;
  const skillsPath = (botId: string) => `/bots/${encodeURIComponent(botId)}/skills`;
  const appPath = (id: string) => `/apps/${encodeURIComponent(id)}`;

  return {
    listResults: (query = {}) => request("GET", withQuery("/results",query)),
    getResult: (id, version) => request("GET", `/results/${encodeURIComponent(id)}${version === undefined ? "" : `?version=${version}`}`),
    getResultVersions: (id, before) => request("GET", `/results/${encodeURIComponent(id)}/versions${before === undefined ? "" : `?before=${before}`}`),
    downloadResult: (id, version) => requestBlob(`/results/${encodeURIComponent(id)}/download?version=${version}`),
    listWork: (query = {}) => request("GET", withQuery("/work",query)),
    getWork: id => request("GET", `/work/${encodeURIComponent(id)}`),
    getWorkRuns: (id, before) => request("GET", `/work/${encodeURIComponent(id)}/runs${before === undefined ? "" : `?before=${before}`}`),
    getWorkActivity: (id, before, after) => request("GET", withQuery(`/work/${encodeURIComponent(id)}/activity`,after!==undefined?{after,limit:100}:{before})),
    getWorkApprovals: (id, before) => request("GET", `/work/${encodeURIComponent(id)}/approvals${before === undefined ? "" : `?before=${before}`}`),
    startWork: (id, revision) => request("POST", `/work/${encodeURIComponent(id)}/start`, { revision }),
    cancelWork: (id, revision) => request("POST", `/work/${encodeURIComponent(id)}/cancel`, { revision }),
    listRooms: () => request("GET", "/rooms"),
    getModelCatalogue: () => request("GET", "/models/catalogue"),
    refreshModelCatalogue: () => request("POST", "/models/catalogue/refresh", {}),
    botCreationTargets: () => request("GET", "/bots/creation/targets"),
    discoverBotCreation: input => request("POST", "/bots/creation/discover", input),
    botCreationStatus: id => request("GET", `/bots/creation/requests/${encodeURIComponent(id)}`),
    createBot: input => request("POST", "/bots", input),
    roomCreationStatus: id => request("GET", `/rooms/creation/requests/${encodeURIComponent(id)}`),
    createRoom: (input) => request("POST", "/rooms", input),
    getRoom: (id) => request("GET", roomPath(id)),
    listBots: () => request("GET", "/bots"),
    getBotModel: id => request("GET", `/bots/${encodeURIComponent(id)}/model`),
    discoverBotModel: (id, input) => request("POST", `/bots/${encodeURIComponent(id)}/model/discover`, input),
    putBotModel: (id, input) => request("PUT", `/bots/${encodeURIComponent(id)}/model`, input),
    getAvatarLibrary: () => request("GET", "/avatars"),
    getBotSettings: (id) => request("GET", `/bots/${encodeURIComponent(id)}/settings`),
    putBotSettings: (id, patch) => request("PUT", `/bots/${encodeURIComponent(id)}/settings`, patch),
    listEvents: (roomId, after = 0) => request("GET", `${roomPath(roomId)}/events?after=${after}`),
    getAgentRequestManifests:(roomId,id,before)=>request('GET',`${roomPath(roomId)}/agent-requests/${encodeURIComponent(id)}/request-manifests${before===undefined?'':`?before=${before}`}`),
    agentRequests:roomId=>request('GET',`${roomPath(roomId)}/agent-requests`),
    cancelAgentRequest:(roomId,id)=>request('POST',`${roomPath(roomId)}/agent-requests/${encodeURIComponent(id)}/cancel`,{}),
    sendMessage: (roomId, text, attachments, replyToMessageId, replyToQuestion) => request("POST", `${roomPath(roomId)}/messages`, { text, attachments, replyToQuestion, ...(replyToMessageId !== undefined ? { replyToMessageId } : {}) }),
    getDictation: () => request("GET", "/dictation"),
    transcribe: async (roomId, audio, target, signal) => {
      const res = await send(`${roomPath(roomId)}/dictation`, "POST", { authorization: `Bearer ${token}`, "content-type": audio.type, "x-transcription-target": target }, audio, true, signal);
      if (signal.aborted) throw new ApiError("Dictation cancelled", 0);
      if (res.status === 401) { onUnauthorized(); throw new ApiError("Token rejected", 401); }
      let raw: string;
      try { raw = await res.text(); }
      catch { throw new ApiError("Transcription response was interrupted", 0); }
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }
      if (!res.ok) throw apiErrorFrom(data, res.status);
      if (!data || typeof data.text !== "string" || !data.text.trim()) throw new ApiError("No usable transcript was returned", 502);
      return data;
    },
    uploadAttachment: async (roomId, file) => {
      const types: Record<string, string> = { txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
      const res = await send(`${roomPath(roomId)}/uploads`, "POST", { authorization: `Bearer ${token}`, "content-type": file.type || types[file.name.split(".").at(-1)?.toLowerCase() ?? ""] || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, file, true);
      if (res.status === 401) { onUnauthorized(); throw new ApiError("Token rejected", 401); }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw apiErrorFrom(data, res.status);
      return data;
    },
    removeAttachment: (roomId, id) => request("DELETE", `${roomPath(roomId)}/uploads/${encodeURIComponent(id)}`),
    downloadAttachment: (roomId, id) => requestBlob(`${roomPath(roomId)}/uploads/${encodeURIComponent(id)}`),
    listPending: () => request("GET", "/approvals?status=pending"),
    inspectReceipt:(id,input)=>request("POST",`/approvals/${encodeURIComponent(id)}/inspection`,input),
    getApproval:id=>request("GET",`/approvals/${encodeURIComponent(id)}`),
    getMcpInteraction:id=>request("GET",`/mcp/interactions/${encodeURIComponent(id)}`),
    respondMcpInteraction:(id,revision,action,content)=>request("POST",`/mcp/interactions/${encodeURIComponent(id)}/response`,{revision,action,content}),
    conversationRequests:(roomId,before)=>request('GET',`${roomPath(roomId)}/requests${before?'?before='+encodeURIComponent(before):''}`),
    getQuestion:id=>request("GET",`/questions/${encodeURIComponent(id)}`),
    answerQuestion:(id,revision,answer)=>request("POST",`/questions/${encodeURIComponent(id)}/answer`,{revision,answer}),
    getWorkReceipts:(id,before)=>request("GET",`/work/${encodeURIComponent(id)}/receipts${before===undefined?"":`?before=${before}`}`),
    decide: (id, decision) => request("POST", `/approvals/${encodeURIComponent(id)}`, decision),
    health: () => request("GET", "/health", undefined, false),
    getPermissions:(botId,roomId)=>request('GET',`/bots/${encodeURIComponent(botId)}/permissions?roomId=${encodeURIComponent(roomId)}`),
    setPermissions:(botId,roomId,preset,revision,acknowledgeFullAccess)=>request('PUT',`/bots/${encodeURIComponent(botId)}/permissions?roomId=${encodeURIComponent(roomId)}`,{preset,revision,acknowledgeFullAccess}),
    getPermissionAdoption:()=>request('GET','/permissions/adoption'),
    adoptPermissions:(preset,reviewVersion,acknowledgeFullAccess)=>request('POST','/permissions/adoption',{preset,reviewVersion,reviewedLegacy:true,acknowledgeFullAccess}),
    getPermissionDefault:()=>request('GET','/permissions/default'),
    setPermissionDefault:(preset,revision,acknowledgeFullAccess)=>request('PUT','/permissions/default',{preset,revision,acknowledgeFullAccess}),
    getRequestManifests:(turnId,before)=>request("GET",`/turns/${encodeURIComponent(turnId)}/request-manifests${before===undefined?"":`?before=${before}`}`),
    whoami: signal => request("GET", "/whoami", undefined, true, signal),
    listDevices: () => request("GET", "/devices"),
    createPairingCode: (access) => request("POST", "/devices/pairing-codes", access ? { access } : {}),
    setDeviceAccess: (id, access) => request("PATCH", `/devices/${encodeURIComponent(id)}`, { access }),
    revokeDevice: (id, opts) =>
      request("DELETE", `/devices/${encodeURIComponent(id)}${opts?.cascade ? "?cascade=1" : ""}`),
    createDevice: (name, access) => request("POST", "/devices", access ? { name, access } : { name }),
    getSettings: () => request("GET", "/settings"),
    putSetting: (key, value) => request("PUT", `/settings/${encodeURIComponent(key)}`, value),
    sendWakeFeedback: (id) => request("POST", `/wake/decisions/${id}/feedback`, { verdict: "should_have_pinged" }),
    getBotMemory: (id) => request("GET", `/bots/${encodeURIComponent(id)}/memory`),
    putBotMemory: (id, text) => request("PUT", `/bots/${encodeURIComponent(id)}/memory`, { text }),
    searchMemory: (bot, q) => request("GET", `/memory/search?bot=${encodeURIComponent(bot)}&q=${encodeURIComponent(q)}`),
    getModelsStatus: () => request("GET", "/models/status"),
    getWakeDecisions: (limit) => request("GET", limit === undefined ? "/wake/decisions" : `/wake/decisions?limit=${limit}`),
    getDigest: () => request("GET", "/digest"),
    sendBriefNow: () => request("POST", "/brief"),
    listResponsibilities:()=>request('GET','/responsibilities'),
    createResponsibility:input=>request('POST','/responsibilities',input),
    updateResponsibility:(id,patch)=>request('PUT','/responsibilities/'+encodeURIComponent(id),patch),
    responsibilityHistory:id=>request('GET','/responsibilities/'+encodeURIComponent(id)+'/history'),
    previewAutomationSchedule: (input, signal) => { const query = new URLSearchParams({scheduleCron: input.scheduleCron, outputMode: input.outputMode, enabled: String(input.enabled)}); if (input.tz) query.set("tz", input.tz); return request("GET", "/automations/schedule-preview?" + query, undefined, true, signal); },
    listAutomations: () => request("GET", "/automations"),
    createAutomation: (input) => request("POST", "/automations", input),
    updateAutomation: (id, patch) => request("PUT", automationPath(id), patch),
    rotateAutomationSecret: (id) => request("POST", `${automationPath(id)}/secret`),
    deleteAutomation: (id) => request("DELETE", automationPath(id)),
    listAutomationRuns:(automationId,before)=>request("GET",`/automation-runs?limit=25${automationId?`&automationId=${encodeURIComponent(automationId)}`:''}${before?`&before=${before}`:''}`),
    getAutomationRun:id=>request("GET",`/automation-runs/${encodeURIComponent(id)}`),
    runAutomation: (id) => request("POST", `${automationPath(id)}/run`),
    generatePushTopic: () => request("POST", "/push/topic"),
    sendPushTest: () => request("POST", "/push/test"),
    getPushStatus: () => request("GET", "/push/status"),
    getMcpServers: () => request("GET", "/mcp/servers"),
    reloadMcp: () => request("POST", "/mcp/reload"),
    addMcpServer: (id, input, digest) => request("POST", "/mcp/servers", { id, ...input, ...(digest !== undefined ? { digest } : {}) }),
    updateMcpServer: (id, input, digest) => request("PATCH", `/mcp/servers/${encodeURIComponent(id)}`, { ...input, digest }),
    removeMcpServer: (id, digest) => request("DELETE", `/mcp/servers/${encodeURIComponent(id)}?digest=${encodeURIComponent(digest)}`),
    checkMcpServer: (input) => request("POST", "/mcp/servers/check", input),
    getMcpCheck: (approvalId) => request("GET", `/mcp/servers/check/${encodeURIComponent(approvalId)}`),
    getMcpOAuth: (serverId, signal) => request("GET", `/mcp/servers/${encodeURIComponent(serverId)}/oauth`, undefined, true, signal),
    mcpOAuth: (serverId, action, body, signal) => request("POST", `/mcp/servers/${encodeURIComponent(serverId)}/oauth/${action}`, body, true, signal),
    setMcpOAuthClient: (serverId, clientId, clientSecret) => request("PUT", `/mcp/servers/${encodeURIComponent(serverId)}/oauth/client`, { clientId, ...(clientSecret ? { clientSecret } : {}) }),
    removeMcpOAuthClient: serverId => request("DELETE", `/mcp/servers/${encodeURIComponent(serverId)}/oauth/client`),
    proposeMcpCommand: (input) => request("POST", "/mcp/servers/command-review", input),
    getMcpCommandReview: (approvalId) => request("GET", `/mcp/servers/command-review/${encodeURIComponent(approvalId)}`),
    getMcpSecrets: () => request("GET", "/mcp/secrets"),
    setMcpSecret: (serverId, name, value, origin) => request("PUT", `/mcp/secrets/${encodeURIComponent(serverId)}/${encodeURIComponent(name)}`, { value, ...(origin !== undefined ? { origin } : {}) }),
    removeMcpSecret: (serverId, name) => request("DELETE", `/mcp/secrets/${encodeURIComponent(serverId)}/${encodeURIComponent(name)}`),
    getComputer: () => request("GET", "/computer"),
    putComputerBackend: (backend) => request("PUT", "/settings/computer", { backend }),
    applyComputerBackend: () => request("POST", "/computer/backend/apply"),
    startComputer: () => request("POST", "/computer/start"),
    stopComputer: () => request("POST", "/computer/stop"),
    destroyComputer: () => request("DELETE", "/computer"),
    computerScreenshot: () => requestBlob("/computer/screenshot"),
    getTakeover: () => request("GET", "/computer/takeover"),
    takeControl: () => request("POST", "/computer/takeover"),
    handBack: () => request("POST", "/computer/handback"),
    getReflection: () => request("GET", "/reflection"),
    runReflection: () => request("POST", "/reflection/run"),
    listSkills: (botId) => request("GET", skillsPath(botId)),
    getSkill: (botId, slug) => request("GET", `${skillsPath(botId)}/${encodeURIComponent(slug)}`),
    getSkillLibrary: () => request("GET", "/skills/library"),
    setSkillLibrary: enabled => request("PUT", "/skills/library", { enabled }),
    getSkillCatalogue: botId => request("GET", `/skills?botId=${encodeURIComponent(botId)}`),
    assignSkills: (botId, ids) => request("PUT", `${skillsPath(botId)}/assignments`, { ids }),
    inspectSkill: (botId, id) => request("GET", `/skills/package?botId=${encodeURIComponent(botId)}&id=${encodeURIComponent(id)}`),
    getSetupReview: (id) => request("GET", `/app-library/setup/${encodeURIComponent(id)}`),
    getAppLibrary: () => request("GET", "/app-library"),
    getConnectors: () => request("GET", "/connectors"),
    getComposio: signal => request("GET", `/connectors/composio?origin=${encodeURIComponent(window.location.origin)}`, undefined, true, signal),
    composioConnector: (action, body, signal) => request("POST", `/connectors/composio/${action}`, body, true, signal),
    googleConnector: (action, body) => request("POST", `/connectors/google/${action}`, body),
    appleConnector: (action, app) => request("POST", `/connectors/apple/${action}`, { app }),
    listApps: () => request("GET", "/apps"),
    reloadApps: () => request("POST", "/apps/reload"),
    reviewApp: (id) => request("GET", `${appPath(id)}/review`),
    enableApp: (id, hash) => request("POST", `${appPath(id)}/enable`, { hash }),
    disableApp: (id) => request("POST", `${appPath(id)}/disable`),
    updateRoom: (roomId, patch) => request("PATCH", roomPath(roomId), patch),
    setRoomRouting: (roomId, input) => request("PUT", `${roomPath(roomId)}/router`, input),
    discoverRoomRouter: (roomId, input) => request("POST", `${roomPath(roomId)}/router/discover`, input),
    getRouterStrategies: () => request("GET", "/router"),
    setRoomRouter: (roomId, strategy) => request("PUT", `${roomPath(roomId)}/router`, { strategy }),
    getSlackStatus: () => request("GET", "/slack"),
    putSlack: (value) => request("PUT", "/settings/slack", value),
    getRtcStatus: () => request("GET", "/rtc"),
    createRtcInvite: () => request("POST", "/rtc/invite"),
    generateRtcTopic: () => request("POST", "/rtc/topic"),
    putRtc: (value) => request("PUT", "/settings/rtc", value),
    getBackups: () => request("GET", "/backups"),
    runBackup: () => request("POST", "/backups/run"),
    getOps: () => request("GET", "/ops"),
    getReadiness: () => request("GET", "/readiness"),
    applyReadiness: () => request("POST", "/readiness/apply"),
  };
}

/**
 * Redeems a pairing code for a device token. Unauthenticated by design: the code is the credential.
 * Errors carry the daemon's message only, never a token.
 */
export async function pair(
  code: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ deviceId: string; token: string }> {
  let res: Response;
  try {
    res = await fetchImpl("/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
  } catch {
    throw new ApiError("Cannot reach the daemon", 0);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const serverMessage =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : null;
    const retry = Number(res.headers.get("retry-after"));
    throw new ApiError(
      serverMessage ?? `Request failed (${res.status})`,
      res.status,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  return data as { deviceId: string; token: string };
}
