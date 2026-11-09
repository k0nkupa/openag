/**
 * The owner token, held for this page only. Module memory: never localStorage, sessionStorage, cookies or the URL,
 * so a reload or closing the tab drops it. Only the same-origin daemon request that was refused with
 * "owner token required" ever sends it (see api.ts).
 */
let held: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

export function getOwnerToken(): string | null {
  return held;
}

export function setOwnerToken(token: string): void {
  if (token.length === 0) return;
  held = token;
  emit();
}

export function clearOwnerToken(): void {
  if (held === null) return;
  held = null;
  emit();
}

/** Calls cb whenever the held token is set or cleared. Returns the unsubscribe function. */
export function subscribeOwnerToken(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
