export type ModelTarget = string;
export interface ModelProvider { id: string; name: string; configured?: boolean; reason?: string | null }
export interface RoutingConfig { provider: string; model: string; reasoning: Reasoning; outputLimit?: number }
export interface RoutingInput { strategy: RouterStrategy; provider?: string; model?: string; reasoning?: Reasoning; revision?: string; snapshotId?: string }
export type Reasoning = Record<string, string | boolean | number>;
export interface ModelReport { roomId: string; at: number; source: "session" | "response"; freshness?: string; warnings?: string[]; provider?: string; modelName?: string; model?: string; effort?: string; turnId?: string; sessionId?: string; revision?: string }
export interface BotModelState { providers?: ModelProvider[]; revision: string; runtime: string; target: ModelTarget | null; model: string | null; reasoning: Reasoning; override: string | null; effectiveModel: string | null; reports: ModelReport[]; reportsTruncated?: boolean }
export interface ModelCatalogueStatus { sources: Array<{ id: string; name: string; configured?: boolean; generation?: string | null; refreshedAt: number | null; attemptedAt: number | null; error: string | null; refreshing: boolean }> }
export interface ModelChoices { target: ModelTarget; snapshotId: string; revision: string; model: string; models: Array<{ id: string; name: string }>; controls: Array<{ id: string; name: string; values?: Array<{ value: string | boolean; name: string }>; min?: number; max?: number }>; reason: string | null; source: string }

export type RouterStrategy = "lead" | "jev" | "openai-decision" | "cheap-same-model";

export interface Room {
  id: string;
  name: string;
  leadBotId: string | null;
  /** Absent from an older daemon: treat as empty. */
  description?: string;
  members: string[];
  /** `room` = created by the user, `direct` = the chat with one bot. Absent from an older daemon: treat as `room`. */
  kind?: "room" | "direct";
  /** Absent from an older daemon; treat as "lead". */
  router?: RouterStrategy;
  routerConfig?: RoutingConfig | null;
  routerRevision?: string;
}

/** One entry from GET /router. `reason` is why the strategy cannot be used (secret-free); null = usable. */
export interface RouterOption {
  providers?: ModelProvider[];
  strategy: RouterStrategy;
  reason: string | null;
}

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
  /** The bot unattended features use when none is chosen. */
  isDefault?: boolean;
}

export const AVATAR_SHAPES = ["controller", "barbell", "mug", "lightbulb", "chat", "sprout", "watering-can", "book", "compass", "robot", "rocket", "telescope"] as const;
// Accepted for existing records; the renderer resolves these to a bundled character.
type LegacyAvatarShape = "blob" | "circle" | "square" | "pill" | "triangle" | "hexagon" | "star" | "pebble" | "cloud" | "droplet";
export const AVATAR_COLORS = ["red", "orange", "yellow", "green", "mint", "teal", "blue", "violet", "pink", "amber", "purple", "brown", "grey", "white"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number] | LegacyAvatarShape | `custom:${string}`;
export type AvatarColor = (typeof AVATAR_COLORS)[number];
/** color null = automatic (the colour the bot's name picks). */
export interface Avatar {
  shape: AvatarShape;
  color: AvatarColor | null;
  /** Absent on older avatars: animation is enabled unless the system reduces motion. */
  animated?: boolean;
}

/** Mirrors GET /bots/:id/settings (owner only). */
export interface BotSettings {
  maxSteps: number;
  id: string;
  name: string;
  description: string;
  instructions: string;
  avatar: Avatar | null;
}

export interface AgentRequest {
  id:string; revision:number;createdAt:number; originMessageId:number; initiatorBotId:string; recipientId:string; kind:'consultation'|'mention';
  status:'accepted'|'running'|'completed'|'incomplete'|'failed'|'cancelled'|'interrupted'|'expired';
  result:string|null;delivery:'pending'|'delivered'|'failed';deadlineAt:number|null;receiptIds:string[];pendingInteractionIds:string[];
}
export type EventType =
  | "agent_request"
  | "avatar_preview" | "avatar_library_updated"
  | "mcp_interaction_updated"
  | "model_report"
  | "automation_updated"
  | "question_updated" | "attention_updated"
  | "receipt_updated"
  | "result_saved"
  | "work_updated"
  | "config"
  | "message"
  | "route"
  | "bot_output"
  | "tool_call"
  | "tool_result"
  | "approval_requested"
  | "approval_decided"
  | "turn_started"
  | "turn_finished"
  | "error";

export interface MessageReply { messageId: number; actor: string; text: string }

export interface LedgerEvent {
  id: number;
  roomId: string;
  ts: number;
  actor: string;
  type: EventType;
  payload: unknown;
}

export type ApprovalStatus = "pending" | "accepted" | "edited" | "responded" | "ignored";

export interface Approval {
  id: string;
  roomId: string;
  botId: string;
  turnId: string | null;
  toolName: string;
  toolClass: string;
  payload: unknown;
  status: ApprovalStatus;
  /** Retained accepted edit on older decisions without a durable receipt. */
  edit?: unknown;
  createdAt: number;
  /** null = raised from the desk; "slack:U…" = a turn from that Slack user; "slack" = Slack, unknown user. */
  source?: string | null;
  reviewVersion: string;
  toolCallId: string | null;
  review: Record<string,unknown> | null;
  canEdit: boolean;
  responseText?: string | null;
}

export type Decision = (
  | { kind: "accept" }
  | { kind: "edit"; payload: unknown }
  | { kind: "respond"; text: string }
  | { kind: "ignore" }) & {reviewVersion?:string};

export interface Health {
  ok: boolean;
  vec_version: string;
}

export type ToolClass = "read" | "search" | "browse" | "act-local" | "act-external" | "secrets";
export type Mode = "auto" | "ask" | "deny";

export interface HeartbeatSettings {
  enabled: boolean;
  everyMinutes: number;
  /** null = the lead bot of room main. */
  botId: string | null;
  /** null = the built-in heartbeat prompt. */
  prompt: string | null;
}

export interface ActiveHoursSettings {
  /** HH:MM, 24-hour. */
  start: string;
  end: string;
  /** 0 = Sunday. */
  days: number[];
}

export interface WakeSettings {
  /** 0..50 pings delivered per local day. */
  dailyPingBudget: number;
  /** 1..168 hours during which a repeat dedupe key is suppressed. */
  dedupeHours: number;
  urgencyThreshold: "low" | "normal" | "high";
}

export interface WakeDecision {
  id: number;
  ts: number;
  source: string;
  botId: string;
  verdict: "silent" | "digest" | "ping";
  urgency: "low" | "normal" | "high";
  dedupeKey: string;
  reason: string;
  decision: "silent" | "digest" | "ping" | "suppressed";
  suppressedBy: "invalid" | "active_hours" | "dedupe" | "urgency" | "budget" | "no_destination" | null;
  /** The owner said this held-back ping should have been delivered. */
  feedback?: "should_have_pinged" | null;
}

export interface BriefSettings {
  enabled: boolean;
  /** HH:MM, local time. */
  time: string;
  /** 0 = Sunday. */
  days: number[];
}

export interface DigestItem {
  resultId?:string;
  id: number;
  ts: number;
  botId: string;
  text: string;
  dedupeKey: string;
}

export type BriefResult = { sent: true } | { sent: false; reason: "empty" | "disabled" | "already_sent" | "not_due" | "off_day" };

export interface PushSettings {
  enabled: boolean;
  server: string;
  /** Secret. Shown only in the Notifications panel. */
  topic: string | null;
  publicUrl: string | null;
  includeDetail: boolean;
  maxPerHour: number;
}

export type ComputerState = "absent" | "running" | "stopped" | "unknown";

/** Mirrors the daemon's ComputerStatus. `busy` is true while a lifecycle or screenshot call holds or awaits the lock. */
export interface ComputerStatus {
  name: string;
  exists: boolean;
  state: ComputerState;
  status: string | null;
  image: string | null;
  kind: string | null;
  runtime: string | null;
  busy: boolean;
  lastError: string | null;
  /** Optional so an older daemon's status still type-checks. */
  backend?: ComputerBackend;
  capabilities?: ComputerCapabilities;
  backends?: ComputerBackendStatus[];
  wantedBackend?: ComputerBackend;
}

export type ComputerBackend = "cua" | "browserbase" | "docker" | "ssh";

export interface ComputerCapabilities {
  shell: boolean;
  view: "proxy" | "external" | "none";
}

/** `reason` is why the backend cannot start (short, secret-free); null = ready. */
export interface ComputerBackendStatus {
  backend: ComputerBackend;
  reason: string | null;
}

/** Mirrors GET /computer/takeover. `by` and the times are present only while `active`. */
export interface TakeoverStatus {
  active: boolean;
  by?: { kind: "owner" | "device"; name?: string };
  /** ms epoch when control was taken. */
  since?: number;
  /** ms epoch when control releases on its own if idle. */
  idleExpiresAt?: number;
}

/** Mirrors POST /computer/takeover. `viewPath` carries a bearer ticket: never log, store, or render it. `external` means an absolute URL on the backend's own host. */
export interface TakeoverGrant {
  viewPath: string;
  expiresAt: number;
  external?: boolean;
}

export type McpServerState ="connected" | "down" | "skipped" | "invalid" | "refused";

/** Who provides a server: bundled with OpenAg, a managed third-party connection (Composio), or added by the owner. */
export type McpServerOrigin = "builtin" | "connection" | "custom";

export interface McpServerStatus {
  unavailable?:{name:string;reason:string}[];
  id: string;
  transport: "stdio" | "http";
  state: McpServerState;
  detail?: string;
  toolCount: number;
  origin: McpServerOrigin;
  enabled: boolean;
  /** Whether a ready server's tools are offered to agents (every runtime). */
  offerToAgents: boolean;
}

/** The owner's editable view of one `mcp.json` entry. Header values are `${NAME}` references, never resolved values. */
export interface McpEntryView {
  id: string;
  origin: McpServerOrigin;
  transport: "stdio" | "http";
  enabled: boolean;
  offerToAgents: boolean;
  timeoutMs: number;
  url?: string;
  allowPrivateNetwork?: boolean;
  headers?: { name: string; template: string }[];
  /** Sign in with OAuth (OA-457): the scope to ask for and an optional client metadata document address. */
  oauth?: { scope?: string; clientMetadataUrl?: string };
  /** A local command written from the desk (OA-456). Commands the operator wrote have none of these. */
  managedBy?: "desk";
  command?: string;
  args?: string[];
  env?: { name: string; template: string }[];
  review?: { hash: string; executable: string; binding: string };
}

export interface McpEntries { digest: string; servers: McpEntryView[] }

export interface McpStatus {
  servers: McpServerStatus[];
  configPath: string | null;
  /** Present for the owner only (null with `entriesError` when mcp.json cannot be read safely). */
  entries?: McpEntries | null;
  entriesError?: string;
}

/** What POST/PATCH/DELETE /mcp/servers return: the change plus the refreshed status. */
export interface McpServerChange extends McpStatus {
  change: { id: string; action: "added" | "updated" | "removed"; digest: string; status: McpServerStatus | null };
}

/** A stored secret as the owner sees it: names and the last four characters at most, never a value. */
export interface McpSecretView { serverId: string; name: string; origin: string; last4: string | null }

export interface McpServerInput {
  url: string;
  headers?: Record<string, string>;
  allowPrivateNetwork?: boolean;
  offerToAgents?: boolean;
  enabled?: boolean;
  timeoutMs?: number;
  /** OAuth sign-in settings; `null` on an edit turns it off. */
  oauth?: { scope?: string; clientMetadataUrl?: string } | null;
}

export interface McpCheckTool { name: string; description: string }
/** A server check: nothing is contacted until its approval is accepted. */
export type McpCheckState =
  | { state: "pending" | "running" | "declined" | "expired" }
  | { state: "done"; ok: true; tools: McpCheckTool[]; truncated: boolean }
  | { state: "done"; ok: false; reason: string };

/** What a command review shows: exactly what would run. */
export interface McpCommandReviewDisplay { id: string; argv: string[]; env: { name: string; template: string }[]; cwd: string; hash: string; files: { path: string; sha256: string }[] }
export interface McpCommandInput { id: string; command: string; args: string[]; env: Record<string, string>; timeoutMs?: number; offerToAgents?: boolean; enabled?: boolean }
/** A command review: nothing is written or started until its approval is accepted. */
export type McpCommandReviewState =
  | { state: "pending" | "running" | "declined" | "expired" }
  | { state: "done"; ok: true; action: "added" | "updated" }
  | { state: "done"; ok: false; reason: string };

/** A server's OAuth sign-in as the owner sees it: no token, ever. */
export interface McpOAuthStatus { state: "signed_in" | "needs_sign_in"; issuer: string | null; registration: "preregistered" | "cimd" | "dcr" | null; hasOwnerClient: boolean; scope?: string; needsScope?: string }

export interface PushStatus {
  enabled: boolean;
  configured: boolean;
  sentThisHour: number;
  dropped: number;
  lastSentAt: number | null;
  lastError: string | null;
}

export interface PushTestResult {
  ok: boolean;
  reason?: string;
}

export type DictationSettings = { enabled: boolean; provider: "openai" | "ollama"; model: string };
export type DictationStatus = DictationSettings & { reason: string; target: string; configured: boolean; available: boolean; maxBytes: number; maxSeconds: number; choices: Array<{ provider: "openai" | "ollama"; models: Array<{ id: string; name: string; snapshotId: string }> }> };

export interface UserProfile { name: string; avatar: string | null }

export interface DaemonSettings {
  profile?: UserProfile;
  dictation?: DictationSettings;
  connectorSignIn?: { callbackOrigin: string | null; deskOrigins: string[] };
  heartbeat: HeartbeatSettings;
  activeHours: ActiveHoursSettings;
  wake: WakeSettings;
  brief: BriefSettings;
  push?: PushSettings;
  reflection?: ReflectionSettings;
  slack?: SlackSettings;
  rtc?: RtcSettings;
  backup?: BackupSettings;
  limits?: LimitsSettings;
}

/** Mirrors the daemon's `backup` setting. `time` is HH:MM local; `keep` is 1..60. */
export interface BackupSettings {
  enabled: boolean;
  time: string;
  keep: number;
}

/** Mirrors the daemon's `limits` setting. 0 = off. Counts turns, not dollars. */
export interface LimitsSettings {
  maxTurnsPerBotPerDay: number;
  maxUnattendedPerDay: number;
}

export interface BackupEntry {
  name: string;
  bytes: number;
  createdAt: number;
}

/** Mirrors GET /backups. `last` is null before the first run. */
export interface BackupStatus {
  enabled: boolean;
  dir: string;
  mirror: boolean;
  last: { at: number; ok: boolean; name: string | null; error: string | null } | null;
  backups: BackupEntry[];
}

/** Mirrors POST /backups/run. */
export interface BackupRunResult {
  ok: boolean;
  name: string | null;
  error: string | null;
}

/** Mirrors GET /ops. */
export interface OpsStatus {
  startedAt: number;
  healthcheck: { configured: boolean; lastOkAt: number | null; lastError: string | null };
  logs: { lastRotatedAt: number | null; rotated: number };
}

/** One always-on readiness check from the daemon. `how` is what to do when not done. */
export interface ReadinessItem {
  id: string;
  title: string;
  done: boolean;
  required: boolean;
  detail: string;
  how: string;
}

export interface Readiness {
  ready: boolean;
  items: ReadinessItem[];
}

/** `changed` lists the item ids the apply switched on. */
export interface ReadinessApplyResult {
  changed: string[];
  readiness: Readiness;
}

/** Mirrors the daemon's `rtc` setting. `topic` is "(set)" when stored, null when not; the secret never appears here. */
export interface RtcSettings {
  enabled: boolean;
  server: string | null;
  topic: string | null;
  stun: string[];
}

/** Mirrors GET /rtc. `inert` is why WebRTC is not running (null = ready). */
export interface RtcStatus {
  enabled: boolean;
  inert: string | null;
  subscribed: boolean;
  peers: number;
  offers: number;
  rejected: number;
  lastError: string | null;
}

/** Mirrors POST /rtc/invite. Contains secrets: single use, short lived, never logged or persisted by the desk. */
export interface RtcInvite {
  server: string;
  topic: string;
  stun: string[];
  code: string;
  secret: string;
  expiresAt: number;
}

/** Mirrors the daemon's `slack` setting. Tokens are never here; they live in the daemon environment. */
export interface SlackSettings {
  enabled: boolean;
  roomId: string | null;
  /** C... or G... channel id. */
  channelId: string | null;
  /** U... user ids allowed to talk to the bots. */
  allowedUsers: string[];
}

/** Mirrors GET /slack. `inert` is why the integration is not running (null = ready). */
export interface SlackStatus {
  enabled: boolean;
  inert: string | null;
  connected: boolean;
  received: number;
  sent: number;
  dropped: number;
  lastError: string | null;
  lastEventAt: number | null;
}

export interface ReflectionSettings {
  enabled: boolean;
  /** HH:MM, local time. */
  time: string;
  /** Absent = the lead bot. */
  botId?: string;
  lookbackHours: number;
  maxMemoryProposals: number;
  maxSkillProposals: number;
}

export interface ReflectionRun {
  localDate: string;
  startedAt: number;
  /** null while the run is still going. */
  finishedAt: number | null;
  status: string;
  memoryProposals: number;
  skillProposals: number;
}

/** Mirrors GET /reflection. `runs` is newest first, at most 10. */
export interface ReflectionStatus {
  setting: ReflectionSettings;
  running: boolean;
  runs: ReflectionRun[];
}

export type TriggerKind = "cron" | "webhook" | "github" | "slack" | "github_poll";
export type OutputMode = "room" | "wake";
export type Verdict = "silent" | "digest" | "ping" | "suppressed";

export interface Automation {
  runtime?:{nextRunAt:number|null;pollEligibleAt:number|null;timezone:string;running:boolean;reason:string|null;recheckAfterMs:number|null};
  id: string;
  name: string;
  /** null for hook kinds. */
  scheduleCron: string | null;
  /** null = the daemon timezone. */
  tz: string | null;
  botId: string;
  /** null for hook kinds and watchers. */
  roomId: string | null;
  prompt: string;
  enabled: boolean;
  allowApprovals: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastTurnId: string | null;
  triggerKind: TriggerKind;
  /** Public slug for hook kinds, null for cron. */
  hookSlug: string | null;
  /** e.g. "/hooks/h-abc123". Never contains a secret. */
  hookPath: string | null;
  hookEvents: string[];
  outputMode: OutputMode;
  allowTools: boolean;
  lastVerdict: Verdict | null;
  hasSecret: boolean;
  /** github_poll only: "owner/name". */
  pollRepo: string | null;
  /** github_poll only: 5..1440. */
  pollEveryMinutes: number | null;
  /** github_poll only: ms epoch of the last poll, null when never polled. */
  lastPolledAt: number | null;
  /** github_poll only: events found by the last poll. */
  lastPollNew: number | null;
}

export interface SchedulePreviewInput { scheduleCron: string; tz?: string | null; outputMode: "room" | "wake"; enabled: boolean }
export interface SchedulePreview { evaluatedAt: number; timezone: string; nextScheduledAt: number | null; state: "scheduled" | "paused" }

export interface AutomationInput {
  tz?: string | null;
  name: string;
  /** Required for cron. */
  scheduleCron?: string | null;
  botId: string;
  /** Required for cron with outputMode "room". */
  roomId?: string | null;
  prompt: string;
  enabled?: boolean;
  allowApprovals?: boolean;
  /** Create only: the trigger kind cannot be changed later. */
  triggerKind?: TriggerKind;
  hookSlug?: string;
  hookEvents?: string[];
  outputMode?: OutputMode;
  allowTools?: boolean;
  /** github/slack only: the signing secret the user pastes (8..256 chars). */
  secret?: string;
  /** github_poll only: "owner/name". */
  pollRepo?: string;
  /** github_poll only: 5..1440. */
  pollEveryMinutes?: number;
  /** github_poll only: the GitHub token. Create requires it; on update, omit to keep the stored token. */
  pollToken?: string;
}

/** POST /automations response. `secret` is present only when the daemon generated a webhook secret (shown once). */
export interface CreateAutomationResult {
  automation: Automation;
  secret?: string;
}

/** Summary row from GET /bots/:id/skills. */
export interface SkillSummary {
  id?: string;
  source?: "agent" | "shared";
  assigned?: boolean;
  availability?: "available" | "invalid" | "missing";
  reason?: string | null;
  requirements?: string | null;
  slug: string;
  name: string;
  description: string;
  version: number | null;
}

/** Full skill from GET /bots/:id/skills/:slug. */
export interface Skill extends SkillSummary {
  resources?: string[];
  triggers: string[];
  body: string;
}

export type AppState = "disabled" | "enabled" | "invalid";

export type AppToolClass = "read" | "search" | "browse" | "act-local" | "act-external";

/** One tool declared by an App's manifest. `name` is the namespaced `app_<id>_<tool>` form. */
export interface AppTool {
  name: string;
  tool: string;
  description: string;
  class: AppToolClass;
  argv: string[];
  /** Env variable NAMES the tool reads. Values are never sent to the desk. */
  env: string[];
  timeoutSec: number;
}

/** Mirrors GET /apps. `hash` is the sha256 of the manifest the owner reviews before enabling. */
export interface AppInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  hash: string;
  state: AppState;
  missingEnv?: string[];
  requirements?: string[];
  missingRuntime?: string[];
  paused?: boolean;
  error?: string;
  tools: AppTool[];
}

/** Mirrors GET /models/status. Keys are never included: only whether one is set and its last four characters. */
export interface ModelsStatus {
  clis: { id: "claude-code" | "codex"; name: string; adapterPackage: string; adapterInstalled: boolean; usedBy: string[] }[];
  providers: { id: string; name: string; envVar: string; envVars?: string[]; envMode?: string; chat?: boolean; decisions?: boolean; docUrl?: string; set: boolean; last4: string | null; usedFor: string }[];
  ollama: { url: string; reachable: boolean; models: string[]; embedModel: string; embedEnabled: boolean };
}

/** Mirrors GET /bots/:id/memory. */
export interface BotMemory {
  botId: string;
  text: string;
  maxBytes: number;
  /** Rough size of the file in tokens, against the cap that goes into every prompt. */
  headTokens: number;
  headCap: number;
}

export interface MemoryHit {
  text: string;
  source: string;
}

export type WorkStatus = "working" | "needs_input" | "needs_approval" | "completed" | "incomplete" | "failed" | "interrupted" | "cancelled";
export interface WorkItem {
  seq: number; id: string; roomId: string; botId: string; requestId: number; parentId: string | null; delegationId: string | null;
  readyToStart?:boolean;explicit?:boolean;originMessageId?:number|null;originTurnId?:string|null;
  title: string; request: string; status: WorkStatus; nextStep: string;
  plan: { title: string; state: "pending" | "in_progress" | "completed" }[]; planIsExecutionEvidence: false;
  continuedFrom?:string|null; progress: Record<string, number>; revision: number; cancelRequestedAt: number | null; createdAt: number; updatedAt: number;
}
export interface WorkRun { seq: number; id: string; turnId: string | null; messageId: number; status: string; reason: string | null }
export interface WorkApproval { cursor: number; id: string; turnId: string; status: Approval["status"] }
export interface WorkQuery { q?: string; roomId?: string; botId?: string; parentId?: string; status?: WorkStatus; before?: number; limit?: number }

export interface Attachment { id: string; name: string; mimeType: string; bytes: number }
export interface SavedResult {
  seq: number; id: string; version: number; workId: string|null; roomId: string; botId: string;
  turnId: string; toolCallId: string|null; origin?:"tool"|"investigation";investigationId?:string|null; name: string; kind: "comparison" | "draft" | "code" | "note";
  bytes: number; createdAt: number; provenance: "proposed";
}
export interface ResultQuery { workId?: string; roomId?: string; botId?: string; before?: number; limit?: number }

export interface ActionReceipt {
  originRoomId?:string;
  id:string;approvalId:string|null;permission:unknown|null; reviewVersion:string; roomId:string; botId:string; workId:string|null; turnId:string|null; toolCallId:string|null;
  toolName:string;decision:ApprovalStatus|"automatic";proposal:unknown;effective:unknown;
  outcome:"pending"|"completed"|"failed"|"unknown"|"not-run";evidence:{detail?:string;reference?:string;effectVerification?:"not-checked"};
  decidedAt:number;startedAt:number|null;finishedAt:number|null;inspectedAt:number|null;inspection:{note:string;reference:string}|null;
}

export interface WorkQuestion {id:string;workId:string|null;roomId:string;botId:string;prompt:string|null;context:string;source:"question"|"work-report";status:"open"|"answered"|"cancelled";revision:number;answer:string|null;messageId:number|null;continuationState:string|null}

export interface AutomationRun {
 seq:number;id:string;automationId:string;snapshot:{name:string;purpose:string;botId:string;roomId:string|null;triggerKind:TriggerKind;outputMode:OutputMode;tz:string;scheduleCron:string|null;pollRepo:string|null;pollEveryMinutes:number|null;events:string[];allowApprovals:boolean;allowTools:boolean};
 recordKind:"run"|"diagnostic";observedAt:number|null;scheduledAt:number|null;gapUntil:number|null;reason:string|null;phase:string|null;trigger:string;event:string|null;startedAt:number|null;endedAt:number|null;outcome:"running"|"quiet"|"completed"|"incomplete"|"cancelled"|"failed"|"interrupted"|"missed"|"skipped"|"start_failed"|"coverage_gap";summary:string;
 roomId:string|null;messageId:number|null;turnId:string|null;workId:string|null;wakeDecisionId:number|null;delivery:{kind:string;destination?:string;referenceId?:number};
}

export type LibraryState = "available" | "setup" | "ready" | "paused" | "unavailable" | "failed";
export interface LibraryEntry {
  id: string; runtimeId: string; kind: "app" | "mcp" | "connector"; name: string; description: string;
  category: string; brand?: "composio"; setupId?: string; digest?: string; installed: boolean; state: LibraryState; reason: string;
  source: string; version: string | null; requirements: string[];
  tools: { name: string; description: string; class: string }[];
  toolEvidence: "declared" | "discovered";
  accessState?: "setup" | "needs_access" | "connected" | "paused" | "failed";
  verifiedAt?: number | null;
}
export interface LibraryInventory {
  machine: string; appsDir: string | null; configPath: string | null;
  apps: AppInfo[]; servers: McpServerStatus[]; entries: LibraryEntry[];
  counts: { installed: number; ready: number };
}

export interface SetupReview {
  id: string; kind: "app" | "mcp" | "connector"; name: string; version: string; source: string; digest: string; machine: string;
  destination: string; requirements: string[]; tools: {name:string;description:string;class:string}[];
  installedDigest: string | null; configurationDigest: string | null; command: string; disableCommand: string | null; access: string;
}

export interface ConnectorStatus {
  google: { configured: boolean; reason: string | null; account: {email: string} | null; services: {id: "gmail" | "drive"; enabled: boolean; state: "setup" | "needs_access" | "connected" | "paused" | "failed"; verifiedAt: number | null}[] } | null;
  apple: { connected: boolean; busy: boolean; apps: {app: string; available: boolean; requirement: string; permission: "unknown" | "granted" | "denied" | "failed"; verifiedAt: number | null}[] } | null;
}

export interface ComposioStatus {
  signIn?: { callbackOrigin: string | null; effectiveCallbackOrigin: string | null; deskOrigins: string[]; callbackLocked: boolean };
  configured: boolean; state: "setup" | "needs_access" | "connected" | "failed"; reason: string | null; hasAccount: boolean;
}

export interface ResponsibilityConfig {name:string;botId:string;roomId:string;bindingId:string;resourceIds:string[];sender:string;topic:string;question:string}
export interface Responsibility extends ResponsibilityConfig {id:string;revision:number;enabled:boolean;readiness:string}
export interface Investigation {sourceConflict?:boolean;id:string;revision:number;status:string;reason:string|null;createdAt:number;endedAt:number|null;resultId:string|null;deliveryState:string;wakeDecisionId:number|null;evidence:Array<{id:string;reference:string;observedAt:number;content:string}>}
export interface ResponsibilityList {responsibilities:Responsibility[];source:{state:string;bindingId:string|null;resourceIds:string[]}}

export interface McpInteraction {response?:{action:string;content?:Record<string,unknown>}|null;id:string;revision:string;serverId:string;roomId:string;botId:string;turnId:string;toolCallId:string;toolName:string;status:string;expiresAt:number;request:{mode:"form"|"url";message:string;requestedSchema?:Record<string,unknown>;host?:string};url?:string}

export type PermissionPreset='read-only'|'workspace-write'|'full-access';
export interface PermissionDefault {adoptionRequired?:boolean;preset:PermissionPreset;revision:number;actor:string;updatedAt:number}
export interface PermissionSession extends PermissionDefault {initialized:boolean;id:string|null;botId:string;roomId:string;workspace:string|null;writeRoots:readonly string[];filesystemMode:'read-only'|'workspace-write'|'danger-full-access';approvalPolicy:'ask'|'never';support:{hostConfinement:boolean;opaqueExecution:boolean};source:'default'|'owner'}
export type PermissionSelection=PermissionDefault|PermissionSession;

export interface PermissionAdoption {active:boolean;revision?:number;reviewVersion?:string;legacyRules?:{bot_id:string;tool_class:string;mode:string}[];bots?:{id:string;name:string}[];legacyDefaults?:Record<string,string>}

export interface RequestRecord {
  id:number; ts:number; turnStatus:string;
  manifest:{manifestId:string;step:number;boundary:string;requestedModel:string;messages:unknown[];messageOverflow:number;toolCount:number;sourceOverflow:number;session?:{context:'fresh'|'reused';reportedModel?:string|null};context?:{sources:Array<{source:string;reference?:number;characters:number;selectedCharacters:number;reason?:string}>;historyOmitted:number;requiredCharacters:number;limit:number|null}};
  evidence:Array<{status?:string;[key:string]:unknown}>;
}
export interface RequestPage {records:RequestRecord[];nextCursor:number|null;receipts?:Array<{id:string;toolName:string}>}

export interface ConversationRequest {kind:"question"|"provider";id:string;at:number;question?:WorkQuestion}
