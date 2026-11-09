// OA-214 spike (NOT part of the build): proves a WebRTC data channel can carry the EXISTING gateway API, with device
// pairing/Bearer auth unchanged. Both peers run in this process with in-memory signaling; see docs/notes/webrtc.md.
//   pnpm -r build && node scripts/spikes/webrtc-spike.mjs     (werift is a dependency of apps/daemon)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/daemon/package.json", import.meta.url));
const { RTCPeerConnection } = require("werift");
const dist = new URL("../../apps/daemon/dist/", import.meta.url);
const { openDb } = await import(new URL("db/index.js", dist));
const { createLedger } = await import(new URL("ledger.js", dist));
const { createApprovals } = await import(new URL("approvals.js", dist));
const { createAuth } = await import(new URL("auth.js", dist));
const { createGateway } = await import(new URL("gateway.js", dist));

const dir = mkdtempSync(join(tmpdir(), "openag-rtc-spike-"));
const db = openDb(dir);
const ledger = createLedger(db);
const auth = createAuth({ db, ownerToken: "owner-spike-token" });
const gateway = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none") });
const deviceToken = auth.createDevice("spike-phone").token;

const MAX_FRAME = 64 * 1024;
const ALLOWED = /^\/(whoami|rooms|bots|approvals|health)(\/|$|\?)/; // the spike proxies a tiny allow-list, not the whole API

// "Daemon" side: every request frame is answered by the real gateway (auth is checked by the gateway, as over HTTP).
const daemon = new RTCPeerConnection({ iceServers: [] });
daemon.onDataChannel.subscribe((channel) => {
  channel.onMessage.subscribe(async (raw) => {
    let id = null;
    try {
      if (raw.length > MAX_FRAME) throw new Error("frame too large");
      const f = JSON.parse(String(raw));
      id = f.id;
      if (!["GET", "POST"].includes(f.method) || !ALLOWED.test(f.path)) throw new Error("not allowed");
      const res = await gateway.fetch(new Request(`http://rtc.local${f.path}`, { method: f.method, headers: f.headers ?? {}, body: f.body ?? undefined }));
      channel.send(JSON.stringify({ id, status: res.status, body: (await res.text()).slice(0, MAX_FRAME) }));
    } catch (e) {
      channel.send(JSON.stringify({ id, status: 400, body: String(e.message) }));
    }
  });
});

// "Phone" side.
const phone = new RTCPeerConnection({ iceServers: [] });
const channel = phone.createDataChannel("openag-api");
const pending = new Map();
channel.onMessage.subscribe((raw) => {
  const r = JSON.parse(String(raw));
  pending.get(r.id)?.(r);
});
const call = (method, path, headers = {}) =>
  new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    pending.set(id, resolve);
    channel.send(JSON.stringify({ id, method, path, headers }));
  });

// In-memory signaling (production needs a rendezvous both sides can reach outbound; see the design note).
phone.onIceCandidate.subscribe((c) => c && daemon.addIceCandidate(c));
daemon.onIceCandidate.subscribe((c) => c && phone.addIceCandidate(c));
const offer = await phone.createOffer();
await phone.setLocalDescription(offer);
await daemon.setRemoteDescription(phone.localDescription);
const answer = await daemon.createAnswer();
await daemon.setLocalDescription(answer);
await phone.setRemoteDescription(daemon.localDescription);
await new Promise((resolve) => (channel.readyState === "open" ? resolve() : channel.stateChanged.subscribe((s) => s === "open" && resolve())));

const results = {
  health: (await call("GET", "/health")).status,
  noToken: (await call("GET", "/whoami")).status,
  deviceToken: (await call("GET", "/whoami", { authorization: `Bearer ${deviceToken}` })).status,
  badToken: (await call("GET", "/whoami", { authorization: "Bearer oag_nope" })).status,
  blockedPath: (await call("GET", "/devices", { authorization: `Bearer ${deviceToken}` })).status,
};
console.log(JSON.stringify(results));
const ok = results.health === 200 && results.noToken === 401 && results.deviceToken === 200 && results.badToken === 401 && results.blockedPath === 400;
await phone.close();
await daemon.close();
db.close();
rmSync(dir, { recursive: true, force: true });
console.log(ok ? "SPIKE OK" : "SPIKE FAILED");
process.exit(ok ? 0 : 1);
