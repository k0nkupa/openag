import { join } from "node:path";
import { existsSync } from "node:fs";
import { integrationPackage } from "./integration-packages.js";
import { execFile } from "node:child_process";

export const APPLE_BUNDLES = { mail: "com.apple.mail", calendar: "com.apple.iCal", contacts: "com.apple.AddressBook", reminders: "com.apple.reminders", notes: "com.apple.Notes", messages: "com.apple.MobileSMS", safari: "com.apple.Safari" } as const;
export type AppleApp = keyof typeof APPLE_BUNDLES;

/** Explicit owner action only. Sending an event may open the named app and show a system prompt. */
export async function requestApplePermission(app: AppleApp, run = execFile, platform = process.platform): Promise<"granted" | "denied" | "failed"> {
  if (platform !== "darwin" || !Object.hasOwn(APPLE_BUNDLES, app)) return "failed";
  const target = `application id "${APPLE_BUNDLES[app]}"`;
  const script = `set wasRunning to ${target} is running\ntell ${target} to count windows\nif not wasRunning then\ntry\ntell ${target} to quit\nend try\nend if`;
  const env = Object.fromEntries(["PATH", "HOME", "LANG", "TMPDIR"].filter(k => process.env[k]).map(k => [k, process.env[k]!]));
  if (app === "calendar" || app === "reminders") {
    const executable = join(integrationPackage("apple-apps").sourceDir, "calendar-reader");
    return new Promise(resolve => run(executable, [app === "calendar" ? "permission" : "reminders-permission"], { timeout: 120000, maxBuffer: 4096, env }, (err, out) => {
      if (err) return resolve("failed");
      try { const result = JSON.parse(String(out)); resolve(result.permission === "granted" || result.permission === "denied" ? result.permission : "failed"); }
      catch { resolve("failed"); }
    }));
  }
  return new Promise(resolve => run("/usr/bin/osascript", ["-e", script], { timeout: 120000, maxBuffer: 4096, env }, (err, _out, stderr) => resolve(!err ? "granted" : String(stderr).includes("-1743") ? "denied" : "failed")));
}

/** Status only: existence checks never open an app or inspect its data. */
export function applePrerequisites(platform = process.platform) {
  const imsg = ["/opt/homebrew/bin/imsg", "/usr/local/bin/imsg", ...(process.env.PATH ?? "").split(":").filter(p => p.startsWith("/")).map(p => join(p, "imsg"))].some(path => existsSync(path));
  return Object.keys(APPLE_BUNDLES).map(app => ({ app, available: platform === "darwin" && (app !== "messages" || imsg), requirement: platform !== "darwin" ? "macOS on the daemon host" : app === "messages" ? "imsg on the daemon PATH and Full Disk Access for its launching service; history access is not verified" : app === "calendar" || app === "reminders" ? `${app === "calendar" ? "Calendar" : "Reminders"} Full Access on the daemon host via EventKit; reads are checked separately` : "Automation access on the daemon host; app data access is not verified" }));
}
