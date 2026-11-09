import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, messageOf, type Api } from "./api";
import { useAppLibrary } from "./app-library";
import type { McpEntries, McpStatus } from "./types";

/** A 409 that means "the file changed since you loaded it" (as opposed to a busy lock, a duplicate id or a managed entry). */
export const isStaleDigest = (err: unknown): boolean => err instanceof ApiError && err.status === 409 && /changed since/.test(err.message);

/**
 * The owner's editable view of mcp.json (URL, header names and references, the file digest). Only the owner gets `entries`, so a limited
 * device sees none and shows no controls. It reloads whenever the shared inventory changes (the daemon announces every MCP change).
 * Loads are sequenced: an older read can never replace a newer one.
 */
export function useMcpEntries(api: Api) {
  const inventory = useAppLibrary();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const mine = ++sequence.current;
    try { const next = await api.getMcpServers(); if (mine === sequence.current) { setStatus(next); setError(null); } }
    catch (err) { if (mine === sequence.current) setError(messageOf(err)); }
  }, [api]);
  useEffect(() => { void load(); }, [load, inventory.data]);
  return {
    entries: (status?.entries ?? null) as McpEntries | null,
    entriesError: status?.entriesError ?? error,
    loaded: status !== null,
    reload: load,
    /** Adopts the refreshed status a write returns, so the next write uses the new digest (and an older in-flight read is ignored). */
    adopt: (next: McpStatus) => { sequence.current++; setStatus(next); setError(null); },
  };
}
