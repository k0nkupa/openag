import { useEffect, useRef, useSyncExternalStore } from "react";

const editors = new Set<{ current: { dirty: boolean; busy: boolean } }>();
const listeners = new Set<() => void>();
type LeavePrompt = { kind: "discard" | "busy"; opener: HTMLElement | null };
let prompt: LeavePrompt | null = null;
let settle: ((leave: boolean) => void) | null = null;
const notify = () => listeners.forEach(listener => listener());

/** Register flags only. Drafts and credentials remain in their mounted editors. */
export function useUnsavedChanges(dirty: boolean, busy = false) {
  const editor = useRef({ dirty, busy });
  editor.current = { dirty, busy };
  useEffect(() => {
    editors.add(editor);
    return () => { editors.delete(editor); };
  }, []);
}
export const hasUnsavedChanges = () => [...editors].some(editor => editor.current.dirty || editor.current.busy);
export function useLeavePrompt() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => prompt, () => null);
}
export function resolveLeave(leave = false) {
  const resolve = settle;
  const allowed = leave && prompt?.kind === "discard" && ![...editors].some(editor => editor.current.busy);
  prompt = null; settle = null; notify(); resolve?.(allowed);
}
export async function confirmLeave(): Promise<boolean> {
  if (prompt) return false;
  if (!hasUnsavedChanges()) return true;
  prompt = { kind: [...editors].some(editor => editor.current.busy) ? "busy" : "discard", opener: document.activeElement instanceof HTMLElement ? document.activeElement : null };
  const result = new Promise<boolean>(resolve => { settle = resolve; });
  notify();
  return result;
}
export function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (hasUnsavedChanges()) event.preventDefault();
}
