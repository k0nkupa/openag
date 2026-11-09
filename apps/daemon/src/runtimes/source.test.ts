import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { createLedger } from "../ledger.js";
import { buildDigest } from "../reflection.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { createRunner } from "./runner.js";
import { defaultTools } from "./tools.js";
import type { BotRuntime, TurnContext } from "./types.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-source-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const fake: BotRuntime = {
  async runTurn(ctx: TurnContext) {
    ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text: "reply to: " + String((ctx.message.payload as { text: string }).text) });
    void ctx.authorize("Write", { file_path: "x", content: "x" }); // asks (act-local), never answered in these tests
  },
};

function setup() {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
  const send = async (payload: Record<string, unknown>) => {
    const message = ledger.append("main", payload.source ? "slack" : "user", "message", payload);
    await runner.run(getRoom(db, "main")!, getBot(db, "boss")!, message);
    return message;
  };
  return { ledger, send };
}
const approvalRows = () => db.prepare("SELECT source FROM approvals ORDER BY created_at, rowid").all() as { source: string | null }[];
const states = () => (db.prepare("SELECT state_json FROM turns ORDER BY created_at, rowid").all() as { state_json: string }[]).map((r) => JSON.parse(r.state_json) as Record<string, unknown>);

describe("message source", () => {
  test("a Slack-originated turn tags its approval with the Slack user and is never indexed; a desk turn is unchanged", async () => {
    const { ledger, send } = setup();
    await send({ text: "from the desk" });
    await send({ text: "from slack", source: "slack", slackUser: "U0000ALICE1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(approvalRows()).toEqual([{ source: null }, { source: "slack:U0000ALICE1" }]);
    const [desk, slack] = states();
    expect(desk).not.toHaveProperty("source");
    expect(desk.noIndex).toBeFalsy();
    expect(slack).toMatchObject({ source: "slack:U0000ALICE1", noIndex: true });
    const ev = ledger.list("main").filter((e) => e.type === "approval_requested").map((e) => (e.payload as { source: string | null }).source);
    expect(ev).toEqual([null, "slack:U0000ALICE1"]);
  });

  test("a malformed Slack user id cannot inject text into the tag", async () => {
    const { send } = setup();
    await send({ text: "x", source: "slack", slackUser: "U1; DROP TABLE" });
    await new Promise((r) => setTimeout(r, 20));
    expect(approvalRows()).toEqual([{ source: "slack" }]);
  });

  test("the reflection digest skips Slack messages and the replies of Slack turns", async () => {
    const { send } = setup();
    await send({ text: "desk talk" });
    await send({ text: "slack talk", source: "slack", slackUser: "U0000ALICE1" });
    const digest = buildDigest(db, 0);
    expect(digest).toContain("desk talk");
    expect(digest).toContain("reply to: desk talk");
    expect(digest).not.toContain("slack talk");
  });
});
