import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import type { Computer } from "./computer.js";
import { createViewProxy } from "./computerview.js";
import { openDb, type Db } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { withoutOwnerSecrets } from "./runtimes/acp.js";
import { createTakeover } from "./takeover.js";

const OWNER = "owner-backend-token";
let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-backends-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const ledger = createLedger(db);
  const computer = {
    name: "bb",
    capabilities: () => ({ shell: false, view: "external" as const, hosted: true }),
    setInputGuard() {},
    viewLink: async () => ({ kind: "external" as const, url: "https://live.browserbase.com/view/abc?x=1", expiresAt: Date.now() + 1_800_000 }),
    status: async () => ({ backend: "browserbase", name: "bb", exists: true, state: "running", status: "ready", image: null, kind: null, runtime: null, busy: false, lastError: null }),
    busy: () => false,
  } as unknown as Computer;
  const auth = createAuth({ db, ownerToken: OWNER });
  const takeover = createTakeover({ computer, ledger, checkEveryMs: 3_600_000 });
  const app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none"), computer, dataDir: dir, takeover, viewProxy: createViewProxy({ takeover }) });
  return { app, auth, takeover, bearer: { authorization: `Bearer ${OWNER}`, "content-type": "application/json" } };
}

describe("computer.backend setting", () => {
  test("only the owner can change where the agent's actions run; a paired device gets 403 and nothing changes", async () => {
    const { app, auth, bearer } = setup();
    const device = auth.createDevice("phone").token;
    const asDevice = await app.request("/settings/computer", { method: "PUT", headers: { authorization: `Bearer ${device}`, "content-type": "application/json" }, body: JSON.stringify({ backend: "browserbase" }) });
    expect(asDevice.status).toBe(403);
    const after = (await (await app.request("/settings", { headers: bearer })).json()) as { settings: { computer: { backend: string } } };
    expect(after.settings.computer.backend).toBe("cua");
    const asOwner = await app.request("/settings/computer", { method: "PUT", headers: bearer, body: JSON.stringify({ backend: "browserbase" }) });
    expect(asOwner.status).toBe(200);
    // Other settings stay open to devices.
    const other = await app.request("/settings/heartbeat", { method: "PUT", headers: { authorization: `Bearer ${device}`, "content-type": "application/json" }, body: JSON.stringify({ enabled: false, everyMinutes: 60, botId: null, prompt: null }) });
    expect(other.status).toBe(200);
  });
});

describe("external takeover through the gateway", () => {
  test("returns the live-view URL directly with external:true and sets NO view cookie", async () => {
    const { app, bearer, takeover } = setup();
    const res = await app.request("/computer/takeover", { method: "POST", headers: bearer });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toMatchObject({ viewPath: "https://live.browserbase.com/view/abc?x=1", external: true });
    expect(takeover.state().active).toBe(true);
    // The proxy has nothing to serve for an external link, and no cookie exists anyway.
    expect((await app.request("/computer/view/viewer/")).status).toBe(401);
  });

  test("the live-view URL never appears in the takeover state or the ledger", async () => {
    const { app, bearer } = setup();
    await app.request("/computer/takeover", { method: "POST", headers: bearer });
    const state = JSON.stringify(await (await app.request("/computer/takeover", { headers: bearer })).json());
    const events = JSON.stringify(createLedger(db).list("_system"));
    expect(state).not.toContain("browserbase.com");
    expect(events).not.toContain("browserbase.com");
  });
});

describe("adapter environment", () => {
  test("bots never inherit computer-backend credentials or the owner token", () => {
    const env = withoutOwnerSecrets({ PATH: "/usr/bin", OPENAG_TOKEN: "owner", BROWSERBASE_API_KEY: "bb_key_value_123456", BROWSERBASE_PROJECT_ID: "proj_1234", OPENAG_SSH_KEY_FILE: "/k", OPENAG_SSH_HOST: "h", HOME: "/Users/x" });
    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH"]);
  });

  test("bots never inherit the WebRTC TURN secret", () => {
    const env = withoutOwnerSecrets({ PATH: "/usr/bin", OPENAG_RTC_TURN_SECRET: "x".repeat(20), OPENAG_RTC_TURN_URLS: "turn:a" });
    expect(Object.keys(env)).toEqual(["PATH"]);
  });

  test("bots never inherit the Slack tokens", () => {
    const env = withoutOwnerSecrets({ PATH: "/usr/bin", SLACK_APP_TOKEN: "xapp-1-abc", SLACK_BOT_TOKEN: "xoxb-1-abc" });
    expect(Object.keys(env)).toEqual(["PATH"]);
  });

  test("bots never inherit the router/app keys (and ANTHROPIC_API_KEY would flip Claude to API billing)", () => {
    const env = withoutOwnerSecrets({ PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-x", OPENROUTER_API_KEY: "sk-or-x", COMPOSIO_API_KEY: "ck_x" });
    expect(Object.keys(env)).toEqual(["PATH"]);
  });
});
