import { useSyncExternalStore } from "react";

const KEY = "openag-hide-technical-activity";
const CHANGE = "openag-chat-display-change";
let current = false;
let storageUnavailable = false;

function getHidden() {
  if (storageUnavailable) return current;
  try { return localStorage.getItem(KEY) === "true"; }
  catch { return current; }
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) notify();
  };
  window.addEventListener(CHANGE, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE, notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function setHideTechnicalActivity(hidden: boolean) {
  current = hidden;
  try { localStorage.setItem(KEY, String(hidden)); } catch { storageUnavailable = true; }
  window.dispatchEvent(new Event(CHANGE));
}

export function useHideTechnicalActivity() {
  return useSyncExternalStore(subscribe, getHidden, () => false);
}
