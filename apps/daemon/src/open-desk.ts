import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveDataDir } from "./db/index.js";
import { requestDeskAccess } from "./owner-access.js";

try {
  if (process.platform !== "darwin" && process.platform !== "linux") throw Error("Open desk supports macOS and Linux hosts");
  const url = await requestDeskAccess(resolveDataDir());
  // The OS browser opener receives only a temporary pairing grant, never the owner credential.
  await promisify(execFile)(process.platform === "darwin" ? "/usr/bin/open" : "xdg-open", [url], {
    timeout: 5000, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, DISPLAY: process.env.DISPLAY, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS },
  }).catch(() => { throw Error("Could not open the browser. Check this host's desktop session, then run desk:open again."); });
  console.log("Desk opened. Confirm this browser's full access within five minutes.");
} catch (err) {
  console.error(err instanceof Error ? err.message : "Could not open the desk");
  process.exitCode = 1;
}
