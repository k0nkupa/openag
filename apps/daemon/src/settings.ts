import { parseAvatar } from "./botsettings.js";
import { validProfileImage, PROFILE_IMAGE_MAX_LENGTH } from "./profile-image.js";
import { validCallbackOrigin, validDeskOrigin } from "./callback-address.js";
import { z } from "zod";
import { getDefaultRedactor } from "./redact.js";
import type { Db } from "./db/index.js";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const HeartbeatSchema = z.object({
  enabled: z.boolean().default(false),
  everyMinutes: z.number().int().min(5).max(1440).default(60),
  /** null = the default bot (setting defaultBot). */
  botId: z.string().min(1).nullable().default(null),
  /** null = the built-in heartbeat prompt. */
  prompt: z.string().max(2000).nullable().default(null),
});

export const ActiveHoursSchema = z.object({
  start: z.string().regex(TIME, "start must be HH:MM").default("07:00"),
  end: z.string().regex(TIME, "end must be HH:MM").default("22:00"),
  /** 0 = Sunday. */
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .refine((d) => new Set(d).size === d.length, "days must be unique")
    .default([0, 1, 2, 3, 4, 5, 6]),
});

export const WakeSchema = z.object({
  dailyPingBudget: z.number().int().min(0).max(50).default(3),
  dedupeHours: z.number().int().min(1).max(168).default(24),
  urgencyThreshold: z.enum(["low", "normal", "high"]).default("normal"),
});

export const BriefSchema = z.object({
  enabled: z.boolean().default(true),
  /** Local time of day, HH:MM. The brief is due from here for three hours (see brief.ts). */
  time: z.string().regex(TIME, "time must be HH:MM").default("07:30"),
  /** 0 = Sunday. */
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .refine((d) => new Set(d).size === d.length, "days must be unique")
    .default([0, 1, 2, 3, 4, 5, 6]),
});

/** http or https only, no userinfo (credentials) in the URL. */
const httpUrl = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => {
      try {
        const u = new URL(v);
        return (u.protocol === "http:" || u.protocol === "https:") && u.username === "" && u.password === "";
      } catch {
        return false;
      }
    }, "must be an http(s) URL without credentials");

/** The topic is the only credential on ntfy.sh. Stored here, never in the ledger (see gateway.ts). */
export const PushSchema = z.object({
  enabled: z.boolean().default(false),
  server: httpUrl(200).default("https://ntfy.sh"),
  topic: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/, "topic must be 16-64 letters, digits, _ or -")
    .nullable()
    .default(null),
  /** Click-through address of the desk. */
  publicUrl: httpUrl(300).nullable().default(null),
  includeDetail: z.boolean().default(false),
  maxPerHour: z.number().int().min(1).max(100).default(20),
});

/** Nightly reflection (reflection.ts). Off by default. Memory saves automatically; skill drafts require approval. */
export const ReflectionSchema = z.object({
  enabled: z.boolean().default(false),
  /** Local time of day, HH:MM. The run is due from here for two hours (see reflection.ts). */
  time: z.string().regex(TIME, "time must be HH:MM").default("03:30"),
  /** null = the default bot (setting defaultBot). */
  botId: z.string().min(1).nullable().default(null),
  lookbackHours: z.number().int().min(1).max(72).default(24),
  maxMemoryProposals: z.number().int().min(0).max(10).default(5),
  maxSkillProposals: z.number().int().min(0).max(5).default(3),
});

/**
 * The bot unattended features (heartbeat, reflection) use when no bot is chosen. `null` only until the first start creates
 * it (defaultbot.ts). Owner-only.
 */
export const DefaultBotSchema = z.object({
  botId: z.string().min(1).nullable().default(null),
});

/**
 * Where proactive messages (pings, the morning brief, reflection proposals) go. `null` = the default bot's direct chat.
 * Owner-only. Existing installs that had room `main` keep it (migration 021).
 */
export const DeliveryRoomSchema = z.object({
  roomId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "invalid room id").nullable().default(null),
});

export const COMPUTER_BACKENDS = ["cua", "browserbase", "docker", "ssh"] as const;

/** Which computer the `computer_*` tools drive. Cua is the default; the others are optional and inert until configured. */
export const ComputerSchema = z.object({
  backend: z.enum(COMPUTER_BACKENDS).default("cua"),
});

/** Apps the owner enabled: id -> sha256 of the manifest that was reviewed. Changing the manifest disables the app again. */
export const AppsSchema = z.object({
  paused: z.record(z.string().regex(/^[a-z][a-z0-9]{1,23}$/), z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  enabled: z.record(z.string().regex(/^[a-z][a-z0-9]{1,23}$/), z.string().regex(/^[a-f0-9]{64}$/)).default({}),
});

/**
 * Slack channel (slack.ts). Tokens are env-only. `allowedUsers` is a hard allow-list of Slack user ids: empty = nobody.
 * Owner-only (it decides who can talk to the bots from outside).
 */
export const SlackSchema = z.object({
  enabled: z.boolean().default(false),
  /** The room Slack messages land in (never a hidden `_` room). */
  roomId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "invalid room id").nullable().default(null),
  /** The ONE channel (public C… or private G…). Direct messages are not supported. */
  channelId: z.string().regex(/^[CG][A-Z0-9]{8,14}$/, "channelId must look like C0123456789").nullable().default(null),
  allowedUsers: z
    .array(z.string().regex(/^[UW][A-Z0-9]{6,14}$/, "user ids look like U0123456789"))
    .max(20)
    .refine((a) => new Set(a).size === a.length, "user ids must be unique")
    .default([]),
});

/**
 * WebRTC join-without-VPN (rtc.ts, docs/notes/webrtc.md). OFF by default, OWNER-only. The signaling topic is a secret
 * (random 128-bit, registered with the redactor, generated by POST /rtc/topic); it is stored here like the push topic.
 */
export const RtcSchema = z.object({
  enabled: z.boolean().default(false),
  /** ntfy-compatible server used as the signaling rendezvous. */
  server: httpUrl(200)
    .refine((v) => v.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(v), "must be https (http only for localhost): the topic is a secret")
    .default("https://ntfy.sh"),
  topic: z.string().regex(/^openag-rtc-[A-Za-z0-9_-]{22,64}$/, "invalid topic").nullable().default(null),
  stun: z.array(z.string().regex(/^stuns?:[A-Za-z0-9.-]{1,200}(:\d{1,5})?$/, "invalid STUN url")).max(4).default(["stun:stun.l.google.com:19302"]),
});

/** Online SQLite backups (backup.ts). ON by default: it only reads the DB and writes a copy under $OPENAG_DATA/backups. */
export const BackupSchema = z.object({
  enabled: z.boolean().default(true),
  /** Local time of day, HH:MM. */
  time: z.string().regex(TIME, "time must be HH:MM").default("04:00"),
  keep: z.number().int().min(1).max(60).default(7),
});

/** Turn budget (turns, not dollars). 0 = off. Rolling 24 hours. */
export const LimitsSchema = z.object({
  maxTurnsPerBotPerDay: z.number().int().min(0).max(100_000).default(0),
  maxUnattendedPerDay: z.number().int().min(0).max(100_000).default(0),
});

const ConnectorSignInSchema = z.object({
  callbackOrigin: z.string().max(2048).refine(validCallbackOrigin, "Use an HTTPS callback origin without a path, query or fragment").transform(value => new URL(value).origin).nullable().default(null),
  deskOrigins: z.array(z.string().max(2048).refine(validDeskOrigin, "Use desk origins without paths, queries or fragments").transform(value => new URL(value).origin)).max(20).default([]),
}).strict();

export const ProfileSchema = z.object({
  name: z.string().trim().min(1).max(40).regex(/^[^\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+$/, "Name contains control characters").default("You"),
  avatar: z.string().max(PROFILE_IMAGE_MAX_LENGTH).refine(validProfileImage, "Use a 256 × 256 JPEG image up to 64 KiB").nullable().default(null),
}).strict();

export const KNOWN_SETTINGS = {
  profile: ProfileSchema,
  dictation: z.object({ enabled: z.boolean().default(false), provider: z.enum(["openai", "ollama"]).default("openai"), model: z.string().max(200).regex(/^[a-zA-Z0-9_.~:/@\[\]-]*$/).default("") }).strict().refine(value => !value.enabled || value.model.length > 0, "Choose a transcription model"),
  skillLibrary: z.object({
    enabled: z.boolean().default(false),
    // Prefix agent keys so JSON validation preserves ids such as __proto__.
    assignments: z.record(z.string().regex(/^agent:[A-Za-z0-9_-]{1,64}$/), z.array(z.string().regex(/^shared:[A-Za-z0-9_@.+/-]{1,256}$/)
      .refine(value => value.slice(7).split("/").every(part => part !== "." && part !== ".." && part.length > 0))).max(200))
      .refine(value => Object.keys(value).length <= 200).default({}),
  }).strict(),
  connectorSignIn: ConnectorSignInSchema,
  defaultBot: DefaultBotSchema,
  deliveryRoom: DeliveryRoomSchema,
  backup: BackupSchema,
  limits: LimitsSchema,
  rtc: RtcSchema,
  slack: SlackSchema,
  apps: AppsSchema,
  computer: ComputerSchema,
  reflection: ReflectionSchema,
  heartbeat: HeartbeatSchema,
  activeHours: ActiveHoursSchema,
  wake: WakeSchema,
  brief: BriefSchema,
  push: PushSchema,
} as const;

export type SettingKey = keyof typeof KNOWN_SETTINGS;
export type DefaultBotSetting = z.infer<typeof DefaultBotSchema>;
export type DeliveryRoomSetting = z.infer<typeof DeliveryRoomSchema>;
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
export type ActiveHours = z.infer<typeof ActiveHoursSchema>;
export type Wake = z.infer<typeof WakeSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type Push = z.infer<typeof PushSchema>;
export type Reflection = z.infer<typeof ReflectionSchema>;
export type ComputerSetting = z.infer<typeof ComputerSchema>;
export type AppsSetting = z.infer<typeof AppsSchema>;
export type SlackSetting = z.infer<typeof SlackSchema>;
export type BackupSetting = z.infer<typeof BackupSchema>;
export type LimitsSetting = z.infer<typeof LimitsSchema>;
export type RtcSetting = z.infer<typeof RtcSchema>;
export type Rtc = RtcSetting;
export interface Settings {
  profile: z.infer<typeof ProfileSchema>;
  dictation: z.infer<typeof KNOWN_SETTINGS.dictation>;
  skillLibrary: z.infer<typeof KNOWN_SETTINGS.skillLibrary>;
  connectorSignIn: z.infer<typeof ConnectorSignInSchema>;
  defaultBot: DefaultBotSetting;
  deliveryRoom: DeliveryRoomSetting;
  backup: BackupSetting;
  limits: LimitsSetting;
  rtc: RtcSetting;
  slack: SlackSetting;
  apps: AppsSetting;
  computer: ComputerSetting;
  reflection: Reflection;
  heartbeat: Heartbeat;
  activeHours: ActiveHours;
  wake: Wake;
  brief: Brief;
  push: Push;
}

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

export const isSettingKey = (key: string): key is SettingKey => Object.prototype.hasOwnProperty.call(KNOWN_SETTINGS, key);

function defaultsOf(key: SettingKey): unknown {
  return KNOWN_SETTINGS[key].parse({});
}

function issueText(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

/** Stored value merged over the defaults. Missing, corrupt or invalid stored data falls back to the defaults. */
export function getSetting<K extends SettingKey>(db: Db, key: K): Settings[K] {
  const defaults = defaultsOf(key) as Settings[K];
  const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return defaults;
  let stored: unknown;
  try {
    stored = JSON.parse(row.value_json);
  } catch {
    return defaults;
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return defaults;
  // Old bot-style profile avatars become initials; retain the saved display name.
  if (key === "profile" && parseAvatar((stored as { avatar?: unknown }).avatar)) stored = { ...stored, avatar: null };
  const parsed = KNOWN_SETTINGS[key].safeParse({ ...(defaults as object), ...(stored as object) });
  return parsed.success ? (parsed.data as Settings[K]) : defaults;
}

/** Validates the full value and stores the parsed result (never the raw input). Throws SettingsError. */
export function setSetting<K extends SettingKey>(db: Db, key: K, value: unknown): Settings[K] {
  if (!isSettingKey(key)) throw new SettingsError(`unknown setting ${key}`);
  const parsed = KNOWN_SETTINGS[key].safeParse(value);
  if (!parsed.success) throw new SettingsError(issueText(parsed.error));
  if ((key === "skillLibrary" || key === "profile") && JSON.stringify(getDefaultRedactor().redact(parsed.data)) !== JSON.stringify(parsed.data)) throw new SettingsError(key === "profile" ? "Profile must not contain secrets" : "Skill configuration must not contain secrets");
  db.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  ).run(key, JSON.stringify(parsed.data), Date.now());
  return parsed.data as Settings[K];
}

export function listSettings(db: Db): Settings {
  return {
    profile: getSetting(db, "profile"),
    dictation: getSetting(db, "dictation"),
    skillLibrary: getSetting(db, "skillLibrary"),
    connectorSignIn: getSetting(db, "connectorSignIn"),
    defaultBot: getSetting(db, "defaultBot"),
    deliveryRoom: getSetting(db, "deliveryRoom"),
    backup: getSetting(db, "backup"),
    limits: getSetting(db, "limits"),
    rtc: getSetting(db, "rtc"),
    slack: getSetting(db, "slack"),
    apps: getSetting(db, "apps"),
    computer: getSetting(db, "computer"),
    reflection: getSetting(db, "reflection"),
    heartbeat: getSetting(db, "heartbeat"),
    activeHours: getSetting(db, "activeHours"),
    wake: getSetting(db, "wake"),
    brief: getSetting(db, "brief"),
    push: getSetting(db, "push"),
  };
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** OPENAG_TZ when it is a valid IANA zone, otherwise the system zone. */
export function resolveTimezone(): string {
  const env = process.env.OPENAG_TZ;
  if (env && isValidTimezone(env)) return env;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

export function localParts(date: Date, tz: string): { weekday: number; minutes: number } {
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { weekday: WEEKDAYS[p.weekday ?? ""] ?? 0, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * True when `date` falls in the active window in zone `tz`.
 * - The day check uses the local weekday of the evaluated instant (not the day an overnight window started on).
 * - start < end: active from start (inclusive) to end (exclusive).
 * - start > end (overnight, e.g. 22:00-06:00): active from start until midnight and from midnight until end.
 * - start == end: always active, subject to the day check.
 */
export function isWithinActiveHours(date: Date, hours: ActiveHours, tz: string): boolean {
  const { weekday, minutes } = localParts(date, tz);
  if (!hours.days.includes(weekday)) return false;
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}
