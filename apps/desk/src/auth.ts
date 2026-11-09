const KEY = "openag-token";

// Storage can be missing or blocked (private windows, disabled site data). The app then keeps the token for this tab only.
export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* in-memory session only */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

export const DEVICE_NAME_MAX = 64;
const GENERIC_PLATFORMS = new Set(["", "unknown"]);

/** Trims, strips control characters and caps the length, matching what the daemon accepts. */
export function cleanDeviceName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, DEVICE_NAME_MAX);
}

export function defaultDeviceName(nav: Navigator = navigator): string {
  const uaPlatform = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "";
  const platform = (uaPlatform || nav.platform || "").trim();
  if (GENERIC_PLATFORMS.has(platform.toLowerCase())) return "This browser";
  return cleanDeviceName(`${platform} browser`);
}

/** Pairing codes are 8 characters shown as XXXX-XXXX. Input may use any case, spaces or dashes. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function formatCode(input: string): string {
  const c = normalizeCode(input);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Where the desk reaches the daemon over WebRTC (set only after a join-without-VPN sign-in or a manual invite). */
export interface RtcIdentity {
  server: string;
  topic: string;
  stun: string[];
  deviceId: string;
  /** Optional TURN relay credentials; refreshed in the background after each connect. */
  turn?: RtcTurn;
}

import { checkTurn, type RtcTurn } from "./rtc/protocol";

const RTC_KEY = "openag-rtc";
const DEVICE_ID_RE = /^[a-f0-9]{16}$/;

/** Validates a stored identity; anything malformed is treated as absent. */
function parseRtcIdentity(raw: unknown): RtcIdentity | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.server !== "string" || !/^https?:\/\/[^\s]+$/.test(v.server)) return null;
  if (typeof v.topic !== "string" || !/^openag-rtc-[A-Za-z0-9_-]{8,}$/.test(v.topic)) return null;
  if (!Array.isArray(v.stun) || v.stun.some((s) => typeof s !== "string")) return null;
  if (typeof v.deviceId !== "string" || !DEVICE_ID_RE.test(v.deviceId)) return null;
  // A malformed stored turn is dropped; the identity itself stays usable on the direct STUN path.
  let turn: RtcTurn | undefined;
  if (v.turn !== undefined) {
    try {
      turn = checkTurn(v.turn);
    } catch {
      turn = undefined;
    }
  }
  return {
    server: v.server,
    topic: v.topic,
    stun: [...(v.stun as string[])],
    deviceId: v.deviceId,
    ...(turn ? { turn } : {}),
  };
}

export function getRtcIdentity(): RtcIdentity | null {
  try {
    const raw = localStorage.getItem(RTC_KEY);
    if (!raw) return null;
    return parseRtcIdentity(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function setRtcIdentity(identity: RtcIdentity): void {
  try {
    localStorage.setItem(RTC_KEY, JSON.stringify(identity));
  } catch {
    /* in-memory only: the direct path still works */
  }
}

export function clearRtcIdentity(): void {
  try {
    localStorage.removeItem(RTC_KEY);
  } catch {
    /* nothing stored */
  }
}

/** Read temporary join grants before authenticated routing, including an already-open desk. */
export function readJoinInvite(): { code: string; full: boolean } | null {
  const match = /^#\/join\/([A-Za-z0-9-]{4,16})(\/full)?$/.exec(window.location.hash);
  if (!match) return null;
  return { code: match[1], full: Boolean(match[2]) };
}
