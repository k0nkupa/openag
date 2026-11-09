import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { saveSkill } from "./skills.js";
import { createBot, createRoom } from "./rooms.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

let dir: string;
let db: Db;
let app: ReturnType<typeof createGateway>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-skills-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  const ledger = createLedger(db);
  saveSkill(dir, "boss", { slug: "weekly-review", name: "Weekly review", description: "Review the week", body: "1. List wins", triggers: ["weekly"] });
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth: createAuth({ db, ownerToken: TOKEN }),
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
    dataDir: dir,
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /bots/:id/skills", () => {
  test("requires the bearer token", async () => {
    expect((await app.request("/bots/boss/skills")).status).toBe(401);
    expect((await app.request("/bots/boss/skills/weekly-review")).status).toBe(401);
  });

  test("lists the bot's skills (summary fields only)", async () => {
    const res = await app.request("/bots/boss/skills", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skills: [{
        id: "agent:boss:weekly-review", source: "agent", slug: "weekly-review", name: "Weekly review", description: "Review the week", version: 1,
        assigned: true, availability: "available", reason: null, requirements: null,
      }],
    });
  });

  test("unknown bot is a 404", async () => {
    expect((await app.request("/bots/nobody/skills", { headers: auth })).status).toBe(404);
    expect((await app.request("/bots/nobody/skills/weekly-review", { headers: auth })).status).toBe(404);
  });
});

describe("GET /bots/:id/skills/:slug", () => {
  test("returns the full skill including body and triggers", async () => {
    const res = await app.request("/bots/boss/skills/weekly-review", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skill: {
        id: "agent:boss:weekly-review", source: "agent", slug: "weekly-review", name: "Weekly review", description: "Review the week", version: 1, triggers: ["weekly"], body: "1. List wins\n",
        assigned: true, availability: "available", reason: null, requirements: null, resources: [],
      },
    });
  });

  test("unknown slug is a 404", async () => {
    expect((await app.request("/bots/boss/skills/missing", { headers: auth })).status).toBe(404);
  });

  test("path-trick slugs are a 404 (only loadSkill decides what is a slug)", async () => {
    for (const slug of ["..%2Fboss", "..%2F..%2Fetc", "UPPER", "a.b"]) {
      expect((await app.request(`/bots/boss/skills/${slug}`, { headers: auth })).status, slug).toBe(404);
    }
  });
});
