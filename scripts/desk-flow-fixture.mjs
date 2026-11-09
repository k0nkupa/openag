// Child process used only by verify-desk-flow.mjs, so restart checks destroy the actual runtime process.
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
for (const key of Object.keys(process.env)) {
  if (!["PATH", "HOME", "LANG", "TMPDIR"].includes(key)) delete process.env[key];
}
process.env.OPENAG_OLLAMA_URL = "http://127.0.0.1:1";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(`${root}apps/daemon/package.json`);
const { serve } = require("@hono/node-server");
const { z } = require("zod");
const { openDb } = await import(`${root}apps/daemon/dist/db/index.js`);
const { createBot, createRoom, addMember, listBots } = await import(`${root}apps/daemon/dist/rooms.js`);
const { createAuth } = await import(`${root}apps/daemon/dist/auth.js`);
const { createLedger } = await import(`${root}apps/daemon/dist/ledger.js`);
const { createApprovals } = await import(`${root}apps/daemon/dist/approvals.js`);
const { createGateway, attachStream } = await import(`${root}apps/daemon/dist/gateway.js`);
const { ActionFailure } = await import(`${root}apps/daemon/dist/action-receipts.js`);
const { createRunner } = await import(`${root}apps/daemon/dist/runtimes/runner.js`);
const { getDefaultRedactor } = await import(`${root}apps/daemon/dist/redact.js`);
const dir = process.argv[2];
if (!dir || !realpathSync(dir).startsWith(join(realpathSync(tmpdir()), "openag-flow-"))) throw new Error("Only an owned temporary fixture directory is supported");

process.once("message", ({ ownerToken, port }) => {
  const db = openDb(dir);
  const auth = createAuth({ db, ownerToken });
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  getDefaultRedactor().addSecret("room-secret-458296");
  if (!listBots(db).length) {
    for (const [id, name, shape, color] of [
      ["boss", "Boss", "square", "blue"], ["coder", "Coder", "circle", "red"],
      ["researcher", "Researcher", "hexagon", "teal"], ["writer", "Writer", "blob", "violet"],
      ["line-break", "Line\nBreak", "circle", "green"],
    ]) createBot(db, { id, name, runtime: "api", config: { avatar: { shape, color } } });
    for (const [id, lead, members] of [
      ["main", "boss", ["boss", "coder", "researcher"]], ["_system", "boss", []],
      ["_internal", "researcher", ["researcher"]], ["legacy-boss", "boss", ["boss"]],
      ["wrong-lead", "boss", ["coder"]], ["history", "boss", ["boss", "coder"]],
    ]) {
      createRoom(db, { id, leadBotId: lead });
      for (const member of members) addMember(db, id, member);
    }
    for (let i = 0; i < 505; i++) ledger.append("history", "user", "message", { text: `History item ${i}` });
    ledger.append("history", "boss", "bot_output", { text: "Latest history marker" });
  }
  const input = z.object({ requestId: z.number().int().positive(), text: z.string().max(8000) }).strict();
  const tools = {
    fixture_write: async (_context, args) => {
      const value = input.parse(args);
      if (value.text === "[fail]") throw new ActionFailure("Controlled tool failure; no write was attempted");
      mkdirSync(join(dir, "results"), { recursive: true });
      const path = `results/${value.requestId}.txt`;
      writeFileSync(join(dir, path), value.text, { flag: "wx", mode: 0o600 });
      return { path, text: value.text };
    },
  };
  tools.fixture_write.validate=args=>input.parse(args);
  tools.fixture_write.confirm=()=>({outcome:"completed",detail:"Controlled executor wrote the exact temporary file."});
  const runtime = {
    async runTurn(ctx) {
      const text = typeof ctx.message.payload?.text === "string" ? ctx.message.payload.text : "";
      if (text.startsWith("/say ")) {
        ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text: text.slice(5) });
        return;
      }
      // An unknown tool is act-external/ask; it still executes only inside the real runner gate.
      const result = await ctx.callTool("fixture_write", { requestId: ctx.message.id, text });
      ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", {
        turnId: ctx.turnId,
        text: result.ok ? `Saved local result: ${JSON.stringify(result.result)}` : `Action ${result.status}: ${result.message}`,
      });
    },
  };
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, tools, runtimes: { api: runtime } });
  runner.recover();
  const app = createGateway({ db, ledger, approvals, auth, dataDir: dir, deskDir: `${root}apps/desk/dist`, dispatch: (args) => runner.dispatch(args) });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  // Hide internal audits on this browser fixture too: room refresh must also work with RTC-style event filtering.
  const visibleLedger = { ...ledger, subscribe: (roomId, callback) => ledger.subscribe(roomId, (event) => { if (!event.roomId.startsWith("_")) callback(event); }) };
  let detach = attachStream(server, visibleLedger, auth);
  server.once("listening", () => process.send({ type: "ready", url: `http://127.0.0.1:${server.address().port}` }));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    runner.shutdown();
    detach();
    server.closeAllConnections();
    server.close(() => { db.close(); process.exit(0); });
  };
  process.on("message", (message) => {
    if (message.type === "stop") stop();
    if (message.type === "disconnect") { detach(); process.send({ type: "disconnected" }); }
    if (message.type === "connect") { detach(); detach = attachStream(server, visibleLedger, auth); process.send({ type: "connected" }); }
    if (message.type === "reconnect") {
      detach();
      setTimeout(() => { if (!stopping) { detach = attachStream(server, visibleLedger, auth); process.send({ type: "reconnected" }); } }, 3000);
    }
    if (message.type === "revoke") auth.revokeDevice(message.deviceId);
  });
  process.on("disconnect", stop);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
});
