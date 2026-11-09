import { AgentRequestError } from './agent-requests.js';
import type { Room } from "./rooms.js";

// `@name` only counts at the start of the text or after whitespace, so `a@coder.com` never matches.
const MENTION = /(?<![^\s])@([A-Za-z0-9][A-Za-z0-9_-]*)/g;

/** True when the text names a member or @everyone: such a message never goes through the room router. */
export function hasExplicitTarget(text: string, room: Pick<Room, "members">): boolean {
  const names = [...text.matchAll(MENTION)].map((m) => m[1]!.toLowerCase());
  if (names.includes("everyone")) return true;
  const ids = new Set(room.members.map((id) => id.toLowerCase()));
  return names.some((n) => ids.has(n));
}

export function resolveTargets(text: string, room: Pick<Room, "members" | "leadBotId">): string[] {
  const names = [...text.matchAll(MENTION)].map((m) => m[1]!.toLowerCase());
  if (names.includes("everyone")) return [...room.members];
  const byLower = new Map(room.members.map((id) => [id.toLowerCase(), id]));
  const targets: string[] = [];
  for (const n of names) {
    const id = byLower.get(n);
    if (id && !targets.includes(id)) targets.push(id);
  }
  if (targets.length > 0) return targets;
  return room.leadBotId ? [room.leadBotId] : [];
}

/** Desk-only guest addressing; an explicit unknown handle must not silently route to the lead. */
export function directTargets(text: string, room: Pick<Room,'members'|'leadBotId'>, eligibleIds: readonly string[]): string[] {
  const names=[...text.matchAll(MENTION)].map(m=>m[1]!.toLowerCase());
  if(!names.length||names.includes('everyone'))return resolveTargets(text,room);
  const byLower=new Map(eligibleIds.map(id=>[id.toLowerCase(),id]));
  const targets=[...new Set(names.map(name=>{const id=byLower.get(name);if(!id)throw new AgentRequestError(`Unknown agent @${name}.`,400);return id;}))];
  if(targets.length>3)throw new AgentRequestError('Address at most three agents in a direct chat.',400);
  return targets;
}
