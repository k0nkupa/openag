// Records the README demo animation of the desk against controlled demonstration data.
//
//   node scripts/capture-demo.mjs [--deps <dir>] [--dark] [--out <dir>]
//
// It forks itself as a disposable gateway on 127.0.0.1:4795 (never the live daemon's 4747) with a fresh temporary
// OPENAG_DATA, the daemon's own built modules (`pnpm -r build` first) and a scripted fixture runtime: no model, adapter,
// scheduler, computer, network integration or real credential is used. Bot replies come from the fixture runtime, and
// the review card comes from the real runner gate. Only the child it started is stopped and its temporary data removed.
//
// Dependencies are not part of the repository. Install them outside it once and pass the directory with --deps (or
// OPENAG_DEMO_DEPS):  npm install --prefix <dir> playwright-core@1.62.1 gifenc@1.0.3 pngjs@7.0.0
// playwright-core uses an already installed Chromium (`npx playwright install chromium` if missing).
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const PORT = 4795;
// Short temporary root: the review card shows the bound workspace path.
const DATA_ROOT = process.platform === "win32" ? tmpdir() : "/tmp";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

if (process.argv[2] === "--serve") await serve(process.argv[3]);
else await capture();

// ---------------------------------------------------------------------------------------------------------------------
// Child: disposable gateway with demonstration data.
async function serve(dir) {
  if (!dir || !realpathSync(dir).startsWith(join(realpathSync(DATA_ROOT), "openag-demo-"))) throw new Error("Only an owned temporary directory is supported");
  for (const key of Object.keys(process.env)) if (!["PATH", "HOME", "LANG", "TMPDIR"].includes(key)) delete process.env[key];
  process.env.OPENAG_DATA = dir;
  process.env.OPENAG_PORT = String(PORT);
  process.env.OPENAG_OLLAMA_URL = "http://127.0.0.1:1";
  const require = createRequire(`${root}/apps/daemon/package.json`);
  const { serve: listen } = require("@hono/node-server");
  const { z } = require("zod");
  const mod = (path) => import(`${root}/apps/daemon/dist/${path}`);
  const { openDb } = await mod("db/index.js");
  const { createBot, createRoom, addMember } = await mod("rooms.js");
  const { createAuth } = await mod("auth.js");
  const { createLedger } = await mod("ledger.js");
  const { createApprovals } = await mod("approvals.js");
  const { createGateway, attachStream } = await mod("gateway.js");
  const { createRunner } = await mod("runtimes/runner.js");
  const { setSetting } = await mod("settings.js");
  const { createBotModels } = await mod("botmodels.js");

  const db = openDb(dir);
  const auth = createAuth({ db, ownerToken: (await import("node:crypto")).randomBytes(32).toString("hex") });
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);

  for (const [id, name, color, shape, description] of [
    ["bot", "Bot", "blue", "square", "Your default assistant"],
    ["researcher", "Researcher", "teal", "hexagon", "Research and discovery"],
    ["coder", "Coder", "red", "circle", "Builds and maintains code"],
    ["writer", "Writer", "violet", "blob", "Drafts and edits copy"],
  ]) createBot(db, { id, name, runtime: "api", config: { description, avatar: { color, shape } } });
  setSetting(db, "defaultBot", { botId: "bot" });
  for (const [id, name, kind, members] of [
    ["launch", "Launch plan", "room", ["bot", "researcher", "coder", "writer"]],
    ["bot-chat", "Bot", "direct", ["bot"]],
    ["coder-chat", "Coder", "direct", ["coder"]],
    ["research", "Supplier research", "room", ["researcher", "writer"]],
  ]) {
    createRoom(db, { id, name, kind, leadBotId: members[0] });
    for (const bot of members) addMember(db, id, bot);
  }
  ledger.append("bot-chat", "user", "message", { text: "What is on today?" });
  ledger.append("bot-chat", "bot", "bot_output", { text: "Two things: the launch plan needs a decision on release notes, and the supplier quote came back. Nothing has been sent." });
  ledger.append("research", "researcher", "bot_output", { text: "The revised supplier quote is in. Delivery is not clearly included." });
  ledger.append("launch", "user", "message", { text: "Kick-off: we ship v0.5 on Friday. Keep everything local until I approve it." });
  ledger.append("launch", "bot", "bot_output", { text: "Noted. I will route research to @researcher and changes to @coder, and ask before anything is written." });
  auth.createDevice("Phone", "owner", "limited");
  const browser = auth.createDevice("Demo browser", "owner", "full");

  const notes = z.object({ path: z.string().max(200), summary: z.string().max(2000) }).strict();
  const tools = {
    // Writes only inside the temporary data directory, which is deleted afterwards.
    update_release_notes: Object.assign(async (_context, args) => {
      const { path, summary } = notes.parse(args);
      mkdirSync(join(dir, "bots/coder/work"), { recursive: true });
      writeFileSync(join(dir, "bots/coder/work", "CHANGELOG.md"), `${summary}\n`, { mode: 0o600 });
      return { path };
    }, {
      validate: (args) => notes.parse(args),
      confirm: () => ({ outcome: "completed", detail: "Wrote the temporary demonstration workspace." }),
    }),
  };
  const say = (ctx, text) => ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text });
  const runtime = {
    async runTurn(ctx) {
      await pause(900);
      if (ctx.bot.id === "researcher") {
        say(ctx, "Checked the changelog since v0.4: 14 merged changes. Highlights are one-command setup, remote MCP sign-in and hidden URL credentials. No breaking changes.");
        return;
      }
      if (ctx.bot.id === "coder") {
        say(ctx, "Drafted the v0.5 release notes from that summary. Writing CHANGELOG.md needs your review first.");
        const result = await ctx.callTool("update_release_notes", { path: "CHANGELOG.md", summary: "v0.5: one-command setup (pnpm onboard), remote MCP sign-in, hidden URL credentials." });
        say(ctx, result.ok ? "Updated CHANGELOG.md with the v0.5 notes." : `Nothing written (${result.status}).`);
        return;
      }
      say(ctx, "On it.");
    },
  };
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, tools, runtimes: { api: runtime } });
  // Model settings render from the local catalogue; discovery is refused so nothing is contacted.
  const offline = async () => { throw new Error("offline demonstration"); };
  const botModels = createBotModels({ db, ledger, acp: { discover: offline }, withIdleBot: (_id, fn) => fn(), env: {}, fetch: offline });
  const app = createGateway({ db, ledger, approvals, auth, botModels, dataDir: dir, deskDir: `${root}/apps/desk/dist`, dispatch: (args) => runner.dispatch(args) });
  const server = listen({ fetch: app.fetch, hostname: "127.0.0.1", port: PORT });
  const detach = attachStream(server, ledger, auth);
  server.once("listening", () => process.send({ type: "ready", url: `http://127.0.0.1:${PORT}`, token: browser.token }));
  const stop = () => { runner.shutdown(); detach(); server.closeAllConnections(); server.close(() => { db.close(); process.exit(0); }); };
  process.on("message", (m) => { if (m?.type === "stop") stop(); });
  process.on("disconnect", stop);
  process.on("SIGTERM", stop);
}

// ---------------------------------------------------------------------------------------------------------------------
// Parent: start the child, drive the desk, encode the animation, clean up.
async function capture() {
  const deps = resolve(arg("--deps") ?? process.env.OPENAG_DEMO_DEPS ?? "");
  const need = createRequire(join(deps, "package.json"));
  let chromium, GIFEncoder, quantize, applyPalette, PNG;
  try {
    ({ chromium } = need("playwright-core"));
    ({ GIFEncoder, quantize, applyPalette } = need("gifenc"));
    ({ PNG } = need("pngjs"));
  } catch {
    console.error("Missing dependencies. Install outside the repo: npm install --prefix <dir> playwright-core@1.62.1 gifenc@1.0.3 pngjs@7.0.0, then pass --deps <dir>.");
    process.exit(2);
  }
  const outDir = resolve(arg("--out") ?? join(root, "docs/notes/desk-shell"));
  const themes = process.argv.includes("--dark") ? ["light", "dark"] : ["light"];
  const env = Object.fromEntries(["PATH", "HOME", "LANG", "TMPDIR"].map((k) => [k, process.env[k]]).filter(([, v]) => v !== undefined));
  const outputs = [];
  for (const theme of themes) {
    const dir = mkdtempSync(join(DATA_ROOT, "openag-demo-"));
    const child = fork(fileURLToPath(import.meta.url), ["--serve", dir], { env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const browser = await chromium.launch();
    try {
      const [ready] = await once(child, "message", { signal: AbortSignal.timeout(20000) });
      const recorded = await record(browser, ready, theme);
      if (!recorded.frames.length) continue;
      const file = join(outDir, `demo-${theme}.gif`);
      encode(recorded, file, { GIFEncoder, quantize, applyPalette, PNG });
      outputs.push(file);
    } finally {
      await browser.close().catch(() => {});
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.send({ type: "stop" });
        await Promise.race([exited, pause(5000).then(() => child.kill("SIGKILL"))]);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const file of outputs) console.log(`${file} (${(statSync(file).size / 1024 / 1024).toFixed(2)} MB)`);
}

async function record(browser, { url, token }, theme) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "no-preference" });
  await context.addInitScript(([t, th]) => { localStorage.setItem("openag-token", t); localStorage.setItem("openag.theme", th); }, [token, theme]);
  const page = await context.newPage();
  await page.goto(`${url}/#/`);
  await page.waitForLoadState("networkidle");
  await pause(800);
  if (process.argv.includes("--explore")) {
    for (const hash of ["#/", "#/room/bot-chat", "#/room/launch", "#/settings/devices", "#/computer", "#/bots"]) {
      await page.goto(`${url}/${hash}`); await pause(1200);
      await page.screenshot({ path: join(arg("--explore"), `${hash.replace(/[#/]/g, "_")}.png`) });
    }
    return { frames: [], end: 0 };
  }
  // Chromium's screencast sends a frame whenever the page repaints, with its own timestamp, so idle scenes cost nothing.
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp * 1000, png: Buffer.from(data, "base64") });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  const begin = Date.now();
  // Scene 1: home is the default agent's chat, with rooms and agents in the sidebar.
  await pause(1600);
  // Scene 2: a group room; @mentions pick which agents answer.
  await page.getByRole("link", { name: /Launch plan/ }).first().click();
  await pause(900);
  const composer = page.locator("#composer-text");
  const ask = async (prefix, rest) => {
    await composer.click();
    await composer.pressSequentially(prefix, { delay: 70 });
    await pause(650); // the mention picker is open here
    await page.keyboard.press("Tab");
    await pause(200); // let the picked mention move the caret before typing on
    await composer.pressSequentially(rest, { delay: 25 });
    await pause(250);
    await page.keyboard.press("Enter");
  };
  await ask("@res", "summarise what changed since v0.4");
  await page.getByText("14 merged changes").waitFor();
  await pause(1300);
  await ask("@cod", "draft the release notes from that");
  // Scene 3: the write waits for review inside the conversation, then is accepted.
  const accept = page.getByRole("button", { name: "Accept", exact: true });
  await accept.waitFor();
  await pause(2200);
  await accept.hover();
  await pause(400);
  await accept.click();
  await page.getByText("Updated CHANGELOG.md").waitFor();
  await pause(1500);
  // Scene 4: devices and their access level.
  await page.goto(`${url}/#/settings/devices`);
  await page.getByText("Active devices").waitFor();
  await pause(1800);
  await cdp.send("Page.stopScreencast");
  const end = frames[0] ? frames[0].t + (Date.now() - begin) : 0;
  await context.close();
  return { frames, end };
}

function encode({ frames, end }, file, { GIFEncoder, quantize, applyPalette, PNG }) {
  if (!frames.length) throw new Error("No frames were captured");
  mkdirSync(join(file, ".."), { recursive: true });
  // Merge repaints closer than ~66 ms (max ~15 fps) and identical frames into the previous frame's duration.
  const kept = [];
  for (const frame of frames) {
    const prev = kept.at(-1);
    if (prev && (frame.t - prev.t < 66 || Buffer.compare(prev.png, frame.png) === 0)) { if (frame.t - prev.t < 66) prev.png = frame.png; continue; }
    kept.push({ ...frame });
  }
  kept.forEach((frame, i) => { frame.delay = (kept[i + 1]?.t ?? Math.max(end, frame.t + 1500)) - frame.t; });
  const dump = arg("--frames");
  if (dump) { mkdirSync(dump, { recursive: true }); kept.forEach(({ png }, i) => writeFileSync(join(dump, `${String(i).padStart(3, "0")}.png`), png)); }
  const images = kept.map(({ png }) => PNG.sync.read(png));
  // One global palette (255 colours + a transparent slot); unchanged pixels become transparent so frames stay small.
  const sample = images.filter((_, i) => i % Math.max(1, Math.floor(images.length / 12)) === 0);
  const pooled = new Uint8Array(sample.reduce((n, im) => n + im.data.length, 0));
  sample.reduce((offset, im) => { pooled.set(im.data, offset); return offset + im.data.length; }, 0);
  const palette = quantize(pooled, 255, { format: "rgb565" });
  while (palette.length < 255) palette.push([0, 0, 0]);
  palette.push([0, 0, 0]);
  const clear = 255;
  const gif = GIFEncoder();
  let previous;
  images.forEach(({ data, width, height }, i) => {
    const index = applyPalette(data, palette, "rgb565");
    const out = previous ? index.map((v, p) => (v === previous[p] ? clear : v)) : index;
    gif.writeFrame(out, width, height, { palette: i ? undefined : palette, delay: Math.max(20, Math.round(kept[i].delay)), repeat: 0, transparent: i > 0, transparentIndex: clear, dispose: 1 });
    previous = index;
  });
  gif.finish();
  writeFileSync(file, gif.bytes());
  console.log(`${kept.length} frames over ${((Math.max(end, kept.at(-1).t) - kept[0].t) / 1000).toFixed(1)} s`);
}
