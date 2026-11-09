import type { WorkItem } from "./types";

/** Persisted Work is authoritative; ordinary chat does not create it. */
export function isVisibleWork(_item: WorkItem): boolean { return true; }
