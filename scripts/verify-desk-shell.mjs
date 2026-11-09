// Disposable OA-319 gateway. No models, schedules, computer or external tools start here.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

// Never inherit the live daemon's credentials or contact its local model service.
for (const key of Object.keys(process.env)) {
  if (!["PATH", "HOME", "LANG", "TMPDIR"].includes(key)) delete process.env[key];
}
process.env.OPENAG_OLLAMA_URL = "http://127.0.0.1:1";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const require = createRequire(`${root}/apps/daemon/package.json`);
const { serve } = require("@hono/node-server");
const { openDb } = await import(`${root}/apps/daemon/dist/db/index.js`);
const { createBot, createRoom, addMember } = await import(`${root}/apps/daemon/dist/rooms.js`);
const { createAuth } = await import(`${root}/apps/daemon/dist/auth.js`);
const { createLedger } = await import(`${root}/apps/daemon/dist/ledger.js`);
const { createApprovals } = await import(`${root}/apps/daemon/dist/approvals.js`);
const { createGateway, attachStream } = await import(`${root}/apps/daemon/dist/gateway.js`);
const dir = mkdtempSync(`${tmpdir()}/openag-shell-`);
const db = openDb(dir);
const ownerToken = randomBytes(32).toString("hex");
const auth = createAuth({ db, ownerToken });
const ledger = createLedger(db);
const approvals = createApprovals(db, ledger);

for (const [id, name, color, shape, description] of [
  ["boss", "Boss", "blue", "square", "Coordinates your desk"],
  ["researcher", "Researcher", "teal", "hexagon", "Research and discovery"],
  ["coder", "Coder", "red", "circle", "Builds and maintains code"],
]) {
  createBot(db, { id, name, runtime: "api", config: { description, avatar: { color, shape } } });
}
for (const [id, name, members] of [
  ["main", "main", ["boss", "researcher", "coder"]],
  ["openag", "openag", ["boss", "coder"]],
  ["coder-chat", "Coder", ["coder"]],
]) {
  createRoom(db, { id, name, leadBotId: members[0] });
  for (const bot of members) addMember(db, id, bot);
}
ledger.append("main", "user", "message", {
  text: "Check the updated supplier quote and draft a reply. Don’t send it yet.",
});
ledger.append("main", "researcher", "bot_output", {
  text: "The revised lead time works. Delivery is not clearly included, so I have prepared a reply for your review.",
});
ledger.append("coder-chat", "coder", "bot_output", { text: "This is your direct conversation with Coder." });
approvals.request({ roomId: "main", botId: "researcher", toolName: "draft_reply", toolClass: "act-external",
  payload: { draft: "Please confirm delivery is included in the total." } });
auth.createDevice("Phone", "owner", "limited");
const fullCode = auth.createPairingCode("owner", "full").code;
const limitedCode = auth.createPairingCode("owner", "limited").code;

const app = createGateway({
  db, ledger, approvals, auth, dataDir: dir, deskDir: `${root}/apps/desk/dist`,
  dispatch: ({ room, botIds }) => ledger.append(room.id, botIds[0] ?? "boss", "bot_output", {
    text: "Received by the isolated verification gateway. No model or tool was run.",
  }),
});
const server = serve({ fetch: app.fetch, port: 5192, hostname: "127.0.0.1" });
let detach = attachStream(server, ledger, auth);
const base = "http://127.0.0.1:5192";
const req = (path, token = ownerToken, options = {}) => fetch(base + path, {
  ...options,
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...options.headers },
});
assert.equal((await req("/rooms")).status, 200);
assert.equal((await req("/bots")).status, 200);
assert.equal((await req("/whoami", "invalid")).status, 401);
assert.equal((await fetch(base)).status, 200);
const limited = auth.createDevice("Integration check", "owner", "limited");
assert.equal((await req("/bots/coder/settings", limited.token, {
  method: "PUT", body: JSON.stringify({ name: "No" }),
})).status, 403);
assert.equal((await req("/whoami", limited.token)).status, 200);
console.log(JSON.stringify({ url: base, fullCode, limitedCode, checks: "HTTP/static/auth assertions passed; isolated data only" }));

// Interactive controls exercise the real stream without adding fixture routes to the daemon.
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  if (data.trim() === "reconnect") {
    detach();
    setTimeout(() => { detach = attachStream(server, ledger, auth); console.log("Stream restored"); }, 3000);
  }
  if (data.trim() === "approval") {
    approvals.request({ roomId: "main", botId: "coder", toolName: "review_code", toolClass: "act-local",
      payload: { files: ["example.ts"] } });
    console.log("Approval added");
  }
});
process.on("SIGINT", () => {
  detach();
  server.close(() => { db.close(); process.exit(0); });
});
