import { customAvatarRef } from "./avatars.js";
// Editable bot settings (name, description, instructions, avatar). All validation lives here; the gateway
// only checks who is asking. Text is redacted before it is stored. Instructions are never part of GET /bots.

export const AVATAR_SHAPES = ["blob", "circle", "square", "pill", "triangle", "hexagon", "star", "pebble", "cloud", "droplet", "controller", "mug", "sprout", "chat", "barbell", "lightbulb", "watering-can", "book", "compass", "robot", "rocket", "telescope"] as const;
export const AVATAR_COLORS = ["red", "orange", "yellow", "green", "mint", "teal", "blue", "violet", "pink", "amber", "purple", "brown", "grey", "white"] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number] | `custom:${string}`;
export type AvatarColor = (typeof AVATAR_COLORS)[number];
export interface Avatar {
  shape: AvatarShape;
  /** null = automatic: the colour the shape's default uses. */
  color: AvatarColor | null;
  /** Absent on older avatars: animation is enabled unless the system reduces motion. */
  animated?: boolean;
}

export interface BotSettingsPatch {
  maxSteps?: number;
  name?: string;
  description?: string;
  instructions?: string;
  /** null resets to the generated default. */
  avatar?: Avatar | null;
}

export class BotSettingsError extends Error {}

const LIMITS = { name: 40, description: 200, instructions: 8000 } as const;
// Control characters other than tab and newline have no place in a name or a prompt.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function parseAvatar(v: unknown): Avatar | null {
  if (typeof v !== "object" || v === null) return null;
  const { shape, color, animated } = v as { shape?: unknown; color?: unknown; animated?: unknown };
  if (!(typeof shape === "string" && customAvatarRef.test(shape)) && !AVATAR_SHAPES.some(value => value === shape)) return null;
  if (color !== null && color !== undefined && !AVATAR_COLORS.includes(color as AvatarColor)) return null;
  if (animated !== undefined && typeof animated !== "boolean") return null;
  return { shape: shape as AvatarShape, color: (color ?? null) as AvatarColor | null, ...(animated === undefined ? {} : { animated }) };
}

export function parseBotSettings(body: unknown): BotSettingsPatch {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new BotSettingsError("body must be an object");
  const b = body as Record<string, unknown>;
  const known = ["name", "description", "instructions", "avatar", "maxSteps"];
  const extra = Object.keys(b).filter((k) => !known.includes(k));
  if (extra.length > 0) throw new BotSettingsError(`unknown field: ${extra[0]}`);
  const patch: BotSettingsPatch = {};
  for (const key of ["name", "description", "instructions"] as const) {
    if (!(key in b)) continue;
    const v = b[key];
    if (typeof v !== "string") throw new BotSettingsError(`${key} must be a string`);
    const t = key === "instructions" ? v : v.trim();
    if (key === "name" && t === "") throw new BotSettingsError("name cannot be empty");
    if (t.length > LIMITS[key]) throw new BotSettingsError(`${key} is longer than ${LIMITS[key]} characters`);
    if (CONTROL.test(t)) throw new BotSettingsError(`${key} contains control characters`);
    patch[key] = t;
  }
  if('maxSteps' in b){if(typeof b.maxSteps!=='number'||!Number.isSafeInteger(b.maxSteps)||b.maxSteps<1||b.maxSteps>100)throw new BotSettingsError('maxSteps must be an integer from 1 to 100');patch.maxSteps=b.maxSteps;}
  if ("avatar" in b) {
    if (b.avatar === null) patch.avatar = null;
    else {
      const a = parseAvatar(b.avatar);
      if (!a) throw new BotSettingsError("avatar needs a known shape and color");
      patch.avatar = a;
    }
  }
  if (Object.keys(patch).length === 0) throw new BotSettingsError("nothing to change");
  return patch;
}

/** Names and text fields need the owner; the avatar alone can be set from any signed-in device. */
export const needsOwner = (patch: BotSettingsPatch): boolean =>
  patch.maxSteps !== undefined || patch.name !== undefined || patch.description !== undefined || patch.instructions !== undefined;
