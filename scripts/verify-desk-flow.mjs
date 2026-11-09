// Standalone HTTP/browser/runner verification. No unit-test framework or live service is used.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { join } from "node:path";
const dir = mkdtempSync(`${tmpdir()}/openag-flow-`);
const ownerToken = randomBytes(32).toString("hex");
const interactive = process.argv.includes("--serve");
const env = Object.fromEntries(["PATH", "HOME", "LANG", "TMPDIR"].map((key) => [key, process.env[key]]).filter(([, value]) => value !== undefined));
let port = interactive ? 5193 : 0;
let child;
let base;
let deviceToken = ownerToken;
async function start() {
  child = fork(fileURLToPath(new URL("./desk-flow-fixture.mjs", import.meta.url)), [dir], { env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const ready = once(child, "message", { signal: AbortSignal.timeout(15000) });
  child.send({ ownerToken, port });
  const [message] = await ready;
  assert.equal(message.type, "ready");
  base = message.url;
  port = Number(new URL(base).port);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit", { signal: AbortSignal.timeout(10000) });
  child.send({ type: "stop" });
  try { await exited; } catch (error) { child.kill("SIGKILL"); throw error; }
}
const request = async (path, { method = "GET", body, token = deviceToken } = {}) => {
 if(method==='POST'&&path.startsWith('/approvals/')&&body&&body.reviewVersion===undefined){const reviewed=await fetch(base+path,{headers:{authorization:'Bearer '+token}}).then(r=>r.json());body={...body,reviewVersion:reviewed.approval?.reviewVersion};}
 return fetch(base + path, {
  method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
};
const json = async (path) => (await request(path)).json();
const create = (body, token) => request("/rooms", { method: "POST", body, token });
const secret = "room-secret-458296";
async function until(read, predicate, label) {
  const end = Date.now() + 10000;
  do { const result = await read(); if (predicate(result)) return result; await pause(40); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}
const events = (roomId) => json(`/rooms/${roomId}/events`);
const pending = () => json("/approvals?status=pending");
async function post(roomId, text) {
  const response = await request(`/rooms/${roomId}/messages`, { method: "POST", body: { text } });
  assert.equal(response.status, 202);
  return (await response.json()).message;
}
async function approvalFor(message) {
  const result = await until(pending, (r) => r.approvals.some((a) => a.payload.requestId === message.id), "pending approval");
  return result.approvals.find((a) => a.payload.requestId === message.id);
}
async function finished(roomId, turnId) {
  return until(() => events(roomId), (r) => r.events.some((event) => event.type === "turn_finished" && event.payload.turnId === turnId), "turn completion");
}
await start();
try {
  const owner = await (await request("/devices", { method: "POST", body: { name: "Flow verification", access: "full" } })).json();
  deviceToken = owner.token;
  const limited = await (await request("/devices", { method: "POST", body: { name: "Limited phone", access: "limited" } })).json();
  const input = { id: "coder-conversation", name: "Coder", members: ["coder"], kind: "direct" };
  assert.equal((await create(input, "invalid")).status, 401);
  assert.equal((await create(input, limited.token)).status, 403);
  const first = await create(input);
  assert.equal(first.status, 201);
  const direct = (await first.json()).room;
  assert.equal(direct.kind, "direct");
  assert.equal(direct.leadBotId, "coder");
  assert.deepEqual(direct.members, ["coder"]);
  assert.equal((await create(input)).status, 409);
  const reused = await create({ ...input, id: "another-coder" });
  assert.equal(reused.status, 200);
  assert.equal((await reused.json()).room.id, direct.id);
  assert.equal((await request("/rooms/another-coder")).status, 404);
  for (const patch of [
    { id: "_reserved" }, { id: "UPPER" }, { id: "a/b" }, { id: "x".repeat(65) },
    { name: "" }, { name: "bad\u0000name" }, { name: "x".repeat(81) }, { members: null },
    { members: ["unknown"] }, { members: ["coder", "coder"] }, { members: Array(51).fill("coder") },
    { members: "coder" }, { unexpected: true },
  ]) assert.equal((await create({ ...input, id: "invalid-room", ...patch })).status, 400);
  assert.equal((await request("/rooms/invalid-room")).status, 404);
  assert.equal((await create(null)).status, 400);
  const group = await create({ id: "group", name: "Group", members: ["researcher", "coder"] });
  assert.equal(group.status, 201);
  assert.equal((await group.json()).room.leadBotId, "researcher");
  assert.equal((await create({ id: "empty", name: "Empty" })).status, 400);
  const named = (await json("/rooms/legacy-boss")).room;
  assert.equal(named.kind, "room");
  const bossChat = await create({ id: "new-boss", name: "Boss", members: ["boss"], kind: "direct" });
  assert.equal(bossChat.status, 201, "a named one-bot room is not reused as a direct chat");
  assert.equal((await bossChat.json()).room.kind, "direct");
  assert.deepEqual((await json("/rooms/legacy-boss")).room, named, "named room is unchanged");
  const bossReuse = await create({ id: "another-boss", name: "Boss", members: ["boss"], kind: "direct" });
  assert.equal(bossReuse.status, 200);
  assert.equal((await bossReuse.json()).room.id, "new-boss");
  const race = await Promise.all(Array.from({ length: 8 }, (_, i) => create({ id: `race-${i}`, name: "Researcher", members: ["researcher"], kind: "direct" })));
  assert.equal(race.filter((response) => response.status === 201).length, 1);
  assert.equal(race.filter((response) => response.status === 200).length, 7);
  const raceRooms = await Promise.all(race.map((response) => response.json()));
  assert.equal(new Set(raceRooms.map((result) => result.room.id)).size, 1);
  assert.notEqual(raceRooms[0].room.id, "_internal");
  const redacted = await create({ id: "redacted", name: secret, members: ["writer"] });
  assert.equal(redacted.status, 201);
  assert.ok(!JSON.stringify(await redacted.json()).includes(secret));
  const all = await (await request("/rooms")).json();
  assert.ok(all.rooms.every((room) => !room.id.startsWith("_")));
  assert.equal(all.rooms.filter((room) => room.members.length === 1 && room.members[0] === "researcher").length, 1);
  const audits = (await (await request("/rooms/_system/events")).json()).events.filter((event) => event.type === "config" && event.payload.kind === "room_created");
  assert.equal(audits.filter((event) => event.payload.roomId === direct.id).length, 1);
  assert.equal(audits.length, 5);

  console.log("OA-314 HTTP assertions passed: authorization, validation, explicit direct-chat reuse, named-room preservation, concurrent requests, redaction and audit.");
  for (const kind of ["accept", "edit", "respond", "ignore"]) {
    const message = await post(direct.id, `Verify ${kind}`);
    const approval = await approvalFor(message);
    const resultPath = join(dir, "results", `${message.id}.txt`);
    assert.equal(existsSync(resultPath), false, "tool must not execute before approval");
    const decision = kind === "edit" ? { kind, payload: { requestId: message.id, text: "Reviewed edit" } } : kind === "respond" ? { kind, text: "Change the proposal first" } : { kind };
    const results = await Promise.all([0, 1].map(() => request(`/approvals/${approval.id}`, { method: "POST", body: decision })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 1);
    const history = await finished(direct.id, approval.turnId);
    assert.ok(history.events.some((e) => e.type === "tool_result" && e.payload.turnId === approval.turnId));
    if (kind === "accept" || kind === "edit") assert.equal(readFileSync(resultPath, "utf8"), kind === "edit" ? "Reviewed edit" : `Verify ${kind}`);
    else assert.equal(existsSync(resultPath), false, `${kind} must not execute`);
  }
  const bad = await post(direct.id, "Invalid edit");
  const badApproval = await approvalFor(bad);
  assert.equal((await request(`/approvals/${badApproval.id}`, { method: "POST", body: { kind: "edit", payload: { requestId: bad.id, text: 42 } } })).status, 400);
  await request(`/approvals/${badApproval.id}`,{method:"POST",body:{kind:"ignore"}});
  const badHistory = await finished(direct.id, badApproval.turnId);
  assert.ok(badHistory.events.some((e) => e.type === "tool_result" && e.payload.turnId === badApproval.turnId && e.payload.status === "ignored"));
  assert.equal(existsSync(join(dir, "results", `${bad.id}.txt`)), false);
  const failure = await post(direct.id, "[fail]");
  const failureApproval = await approvalFor(failure);
  await request(`/approvals/${failureApproval.id}`, { method: "POST", body: { kind: "accept" } });
  const failureHistory = await finished(direct.id, failureApproval.turnId);
  assert.ok(failureHistory.events.some((e) => e.type === "tool_result" && e.payload.turnId === failureApproval.turnId && e.payload.status === "error"));
  assert.equal(existsSync(join(dir, "results", `${failure.id}.txt`)), false);
  const restartMessage = await post(direct.id, "Restart approval check");
  const beforeRestart = await approvalFor(restartMessage);
  await stop();
  await start();
  const afterRestart = (await pending()).approvals.find((a) => a.id === beforeRestart.id);
  assert.ok(afterRestart, "pending approval survives an actual process restart");
  assert.equal((await request(`/approvals/${afterRestart.id}`, { method: "POST", body: { kind: "accept" } })).status, 200);
  const recovered = await finished(direct.id, afterRestart.turnId);
  assert.equal(readFileSync(join(dir, "results", `${restartMessage.id}.txt`), "utf8"), "Restart approval check");
  assert.equal(recovered.events.filter((e) => e.type === "approval_requested" && e.payload.turnId === afterRestart.turnId).length, 1, "resume must not ask twice");
  const hostile = '<img src=x onerror="alert(1)">';
  const hostileMessage = await post(direct.id, `/say ${hostile} ${secret}`);
  const redactedEvents = await until(() => events(direct.id), (r) => r.events.some((e) => e.type === "bot_output" && e.payload.text?.includes(hostile)), "hostile text result");
  assert.ok(!JSON.stringify(redactedEvents).includes(secret));
  assert.equal((await events("history")).events.length, 500);
  assert.ok((await json(`/rooms/history/events?after=${(await events("history")).events.at(-1).id}`)).events.some((e) => e.payload.text === "Latest history marker"));
  assert.equal(readdirSync(join(dir, "results")).length, 3, "only accept, valid edit and restart acceptance execute");
  console.log("OA-320 HTTP/runner assertions passed: all decisions, duplicate/stale decisions, invalid edits, tool failures, real process restart/resume, redaction and history pagination.");
  if (interactive) {
    const code = async (access) => (await (await request("/devices/pairing-codes", { method: "POST", body: { access } })).json()).code;
    console.log(JSON.stringify({ url: base, fullCode: await code("full"), limitedCode: await code("limited") }));
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", async (data) => {
      try {
        if (["reconnect", "disconnect", "connect"].includes(data.trim())) child.send({ type: data.trim() });
        if (data.trim() === "restart") { await stop(); await start(); console.log("Fixture process restarted"); }
        if (data.trim() === "pending") { await post(direct.id, "Review this local note"); console.log("New runtime approval requested"); }
        if (data.trim() === "codes") console.log(JSON.stringify({ fullCode: await code("full"), limitedCode: await code("limited") }));
        if (data.trim() === "revoke-browser") {
          const devices = (await json("/devices")).devices;
          const browser = devices.find((device) => device.name === "Flow browser" && device.revokedAt === null);
          if (!browser) throw new Error("No active Flow browser device");
          assert.equal((await request(`/devices/${browser.id}`, { method: "DELETE" })).status, 204);
          console.log("Fixture browser revoked");
        }
      } catch (error) { console.error(error.message); }
    });
    process.once("SIGINT", async () => { await stop(); process.exit(0); });
  }
} finally {
  if (!interactive) await stop();
}
