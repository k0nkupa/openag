import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { ComputerError, NOT_RUNNING_MESSAGE, type Computer, type ComputerStatus } from "./computer.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";

const TOKEN = "test-owner-token";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

let dir: string;
let db: Db;
let busy: boolean;
type ComputerMock = Computer & { start: Mock<Computer["start"]>; screenshot: Mock<Computer["screenshot"]> };
let computer: ComputerMock;
let app: ReturnType<typeof createGateway>;
let ownerAuth: Record<string, string>;
let deviceAuth: Record<string, string>;

const status = (over: Partial<ComputerStatus> = {}): ComputerStatus => ({
  backend: "cua",
  name: "openag-main",
  exists: true,
  state: "running",
  status: "ready",
  image: "img",
  kind: "container",
  runtime: "gvisor",
  busy: false,
  lastError: null,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-cua-"));
  db = openDb(dir);
  const ledger = createLedger(db);
  const auth = createAuth({ db, ownerToken: TOKEN });
  busy = false;
  mkdirSync(join(dir, "computer", "screens"), { recursive: true });
  writeFileSync(join(dir, "computer", "screens", "a.png"), PNG);
  computer = {
    name: "openag-main",
    capabilities: () => ({ shell: true, view: "proxy" }),
    busy: () => busy,
    withLock: vi.fn(),
    status: vi.fn(async () => status()),
    start: vi.fn(async () => status()),
    stop: vi.fn(async () => status({ state: "stopped", status: "stopped" })),
    destroy: vi.fn(async () => status({ exists: false, state: "absent" })),
    screenshot: vi.fn(async () => ({ path: "computer/screens/a.png", width: 18, height: 1 })),
  } as unknown as ComputerMock;
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth,
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
    computer,
    dataDir: dir,
  });
  ownerAuth = { authorization: `Bearer ${TOKEN}` };
  const { token } = auth.createDevice("phone");
  deviceAuth = { authorization: `Bearer ${token}` };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => app.request(path, init);

describe("auth", () => {
  it("rejects every computer route without a token", async () => {
    expect((await req("/computer")).status).toBe(401);
    expect((await req("/computer/start", { method: "POST" })).status).toBe(401);
    expect((await req("/computer/stop", { method: "POST" })).status).toBe(401);
    expect((await req("/computer", { method: "DELETE" })).status).toBe(401);
    expect((await req("/computer/screenshot")).status).toBe(401);
  });
});

describe("GET /computer", () => {
  it("returns the status shape", async () => {
    const res = await req("/computer", { headers: ownerAuth });
    expect(res.status).toBe(200);
    // The status plus what the desk needs to adapt to the backend (a plain Computer reports only its own backend).
    expect(await res.json()).toEqual({
      ...status(),
      capabilities: expect.objectContaining({ shell: true }),
      backends: [{ backend: expect.any(String), reason: null }],
      wantedBackend: "cua",
    });
  });
});

describe("start and stop", () => {
  it("start answers 202 and runs in the background", async () => {
    const res = await req("/computer/start", { method: "POST", headers: ownerAuth });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });
    expect(computer.start).toHaveBeenCalledTimes(1);
  });

  it("start answers 409 while a lifecycle call is busy", async () => {
    busy = true;
    const res = await req("/computer/start", { method: "POST", headers: ownerAuth });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "computer is busy" });
    expect(computer.start).not.toHaveBeenCalled();
  });

  it("stop answers 202, and 409 while busy", async () => {
    expect((await req("/computer/stop", { method: "POST", headers: deviceAuth })).status).toBe(202);
    expect(computer.stop).toHaveBeenCalledTimes(1);
    busy = true;
    const res = await req("/computer/stop", { method: "POST", headers: ownerAuth });
    expect(res.status).toBe(409);
  });

  it("a failed background start is not reported as an HTTP error", async () => {
    computer.start.mockRejectedValueOnce(new ComputerError("failed", "resume failed"));
    const res = await req("/computer/start", { method: "POST", headers: ownerAuth });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("DELETE /computer", () => {
  it("is refused for a device token", async () => {
    const res = await req("/computer", { method: "DELETE", headers: deviceAuth });
    expect(res.status).toBe(403);
    expect(computer.destroy).not.toHaveBeenCalled();
  });

  it("is accepted for the owner and destroys in the background", async () => {
    const res = await req("/computer", { method: "DELETE", headers: ownerAuth });
    expect(res.status).toBe(202);
    expect(computer.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("GET /computer/screenshot", () => {
  it("returns fresh PNG bytes with no-store", async () => {
    const res = await req("/computer/screenshot", { headers: deviceAuth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(computer.screenshot).toHaveBeenCalledTimes(1);
  });

  it("answers 503 while a lifecycle call holds the lock", async () => {
    busy = true;
    const res = await req("/computer/screenshot", { headers: ownerAuth });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "computer is busy" });
    expect(computer.screenshot).not.toHaveBeenCalled();
  });

  it("answers 409 when the computer is not running", async () => {
    computer.screenshot.mockRejectedValueOnce(new ComputerError("failed", NOT_RUNNING_MESSAGE));
    const res = await req("/computer/screenshot", { headers: ownerAuth });
    expect(res.status).toBe(409);
  });
});

describe("routes absent without a computer", () => {
  it("does not register /computer", async () => {
    const plain = createGateway({
      db,
      ledger: createLedger(db),
      approvals: createApprovals(db, createLedger(db)),
      auth: createAuth({ db, ownerToken: "other-owner-token-xxxx" }),
      dispatch: () => undefined,
      deskDir: join(dir, "no-desk"),
    });
    const res = await plain.request("/computer", { headers: { authorization: "Bearer other-owner-token-xxxx" } });
    expect(res.status).toBe(404);
  });
});

describe("GET /computer/screens/:name", () => {
  const GOOD = "20260101-000000-000.png";
  const screens = () => join(dir, "computer", "screens");

  beforeEach(() => {
    writeFileSync(join(screens(), GOOD), PNG);
  });

  it("requires the owner or a device token", async () => {
    expect((await req(`/computer/screens/${GOOD}`)).status).toBe(401);
  });

  it("serves a stored screenshot as no-store PNG bytes", async () => {
    const res = await req(`/computer/screens/${GOOD}`, { headers: deviceAuth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("rejects names that do not match the screenshot file shape", async () => {
    for (const name of ["a.png", "20260101-000000-000.jpg", "20260101-000000-000-1.png", "x.png%00", ".png"]) {
      expect((await req(`/computer/screens/${name}`, { headers: ownerAuth })).status).toBe(404);
    }
  });

  it("blocks traversal attempts", async () => {
    writeFileSync(join(dir, "secret.png"), PNG);
    for (const name of ["..%2F..%2Fsecret.png", "..%2Fsecret.png", "%2e%2e%2fsecret.png"]) {
      expect((await req(`/computer/screens/${name}`, { headers: ownerAuth })).status).toBe(404);
    }
  });

  it("refuses a symlink that points outside the screens directory", async () => {
    const outside = join(dir, "outside.png");
    writeFileSync(outside, PNG);
    const link = "20260101-000000-001.png";
    symlinkSync(outside, join(screens(), link));
    expect((await req(`/computer/screens/${link}`, { headers: ownerAuth })).status).toBe(404);
  });

  it("answers 404 for a valid name that does not exist", async () => {
    expect((await req("/computer/screens/20991231-235959-999.png", { headers: ownerAuth })).status).toBe(404);
  });
});

