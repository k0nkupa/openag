import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { openDb, type Db } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";

const OWNER = "owner-slack-token";
let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-slack-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const ledger = createLedger(db);
  const auth = createAuth({ db, ownerToken: OWNER });
  const slack = { reload: vi.fn(), status: vi.fn(() => ({ enabled: true, inert: null, connected: true, received: 1, sent: 2, dropped: 0, lastError: null, lastEventAt: null })) };
  const app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none"), slack });
  const device = auth.createDevice("phone").token;
  return { app, slack, owner: { authorization: `Bearer ${OWNER}`, "content-type": "application/json" }, dev: { authorization: `Bearer ${device}`, "content-type": "application/json" } };
}
const value = { enabled: true, roomId: "main", channelId: "C0123456789", allowedUsers: ["U0000ALICE1"] };

describe("slack routes", () => {
  test("only the owner can change the setting (it decides who can talk to the bots); the change reloads the channel", async () => {
    const { app, slack, owner, dev } = setup();
    expect((await app.request("/settings/slack", { method: "PUT", headers: dev, body: JSON.stringify(value) })).status).toBe(403);
    expect(slack.reload).not.toHaveBeenCalled();
    expect((await app.request("/settings/slack", { method: "PUT", headers: owner, body: JSON.stringify(value) })).status).toBe(200);
    expect(slack.reload).toHaveBeenCalledTimes(1);
    expect((await app.request("/settings/slack", { method: "PUT", headers: owner, body: JSON.stringify({ ...value, channelId: "nope" }) })).status).toBe(400);
  });

  test("GET /slack needs auth and returns the status (no secrets)", async () => {
    const { app, dev } = setup();
    expect((await app.request("/slack")).status).toBe(401);
    const res = await app.request("/slack", { headers: dev });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, sent: 2 });
  });
});
