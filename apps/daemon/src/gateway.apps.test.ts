import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAppsManager } from "./apps.js";
import { createAuth } from "./auth.js";
import { openDb, type Db } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { classify } from "./policy.js";
import { getSetting, setSetting } from "./settings.js";

const OWNER = "owner-apps-token";
let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-apps-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const d = join(dir, "apps", "demo");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "manifest.json"), JSON.stringify({ id: "demo", name: "Demo", version: "1", tools: [{ name: "ping", description: "p", class: "read", exec: { argv: ["node", "t.mjs"] } }] }));
  writeFileSync(join(d, "t.mjs"), "console.log('{}')");
  const apps = createAppsManager({ dataDir: dir, getEnabled: () => getSetting(db, "apps").enabled, setEnabled: (enabled) => void setSetting(db, "apps", { enabled }) });
  apps.scan();
  const ledger = createLedger(db);
  const auth = createAuth({ db, ownerToken: OWNER });
  const app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none"), apps });
  const device = auth.createDevice("phone").token;
  return { app, ledger, owner: { authorization: `Bearer ${OWNER}`, "content-type": "application/json" }, dev: { authorization: `Bearer ${device}`, "content-type": "application/json" } };
}

describe("apps routes", () => {
  test("any authenticated client can LIST; only the owner can reload, enable or disable", async () => {
    const { app, owner, dev } = setup();
    expect((await app.request("/apps")).status).toBe(401);
    const list = (await (await app.request("/apps", { headers: dev })).json()) as { apps: Array<{ id: string; hash: string; state: string }> };
    expect(list.apps[0]).toMatchObject({ id: "demo", state: "disabled" });
    const hash = list.apps[0]!.hash;
    for (const [path, body] of [["/apps/reload", {}], ["/apps/demo/enable", { hash }], ["/apps/demo/disable", {}]] as const) {
      expect((await app.request(path, { method: "POST", headers: dev, body: JSON.stringify(body) })).status, path).toBe(403);
    }
    expect(getSetting(db, "apps").enabled).toEqual({});
    expect(classify("app_demo_ping")).toBe("act-external");
    const en = await app.request("/apps/demo/enable", { method: "POST", headers: owner, body: JSON.stringify({ hash }) });
    expect(en.status).toBe(200);
    expect(getSetting(db, "apps").enabled).toEqual({ demo: hash });
    expect(classify("app_demo_ping")).toBe("read");
  });

  test("enabling needs the exact reviewed hash (409 otherwise) and is audited; disabling is audited", async () => {
    const { app, owner, ledger } = setup();
    const bad = await app.request("/apps/demo/enable", { method: "POST", headers: owner, body: JSON.stringify({ hash: "0".repeat(64) }) });
    expect(bad.status).toBe(409);
    expect((await app.request("/apps/demo/enable", { method: "POST", headers: owner, body: "{}" })).status).toBe(409);
    const hash = ((await (await app.request("/apps", { headers: owner })).json()) as { apps: Array<{ hash: string }> }).apps[0]!.hash;
    await app.request("/apps/demo/enable", { method: "POST", headers: owner, body: JSON.stringify({ hash }) });
    await app.request("/apps/demo/disable", { method: "POST", headers: owner });
    const actions = ledger.list("_system").map((e) => (e.payload as { action?: string }).action);
    expect(actions).toEqual(expect.arrayContaining(["app_enabled", "app_disabled"]));
    expect((await app.request("/apps/ghost/disable", { method: "POST", headers: owner })).status).toBe(404);
  });

  test("the generic settings route cannot be used by a device to enable an app", async () => {
    const { app, dev } = setup();
    const res = await app.request("/settings/apps", { method: "PUT", headers: dev, body: JSON.stringify({ enabled: { demo: "a".repeat(64) } }) });
    expect(res.status).toBe(403);
    expect(getSetting(db, "apps").enabled).toEqual({});
  });

  test("a hand-written settings value for an app is ignored unless it matches the manifest hash (no blind enable)", async () => {
    const { app, owner } = setup();
    await app.request("/settings/apps", { method: "PUT", headers: owner, body: JSON.stringify({ enabled: { demo: "a".repeat(64) } }) });
    const res = (await (await app.request("/apps/reload", { method: "POST", headers: owner })).json()) as { apps: Array<{ state: string }> };
    expect(res.apps[0]!.state).toBe("disabled");
    expect(getSetting(db, "apps").enabled).toEqual({}); // the stale entry was dropped
  });
});
