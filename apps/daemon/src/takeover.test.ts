import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputerError, type Computer } from "./computer.js";
import { makeFakeCua, type FakeCua } from "./computer/harness.testkit.js";
import { openDb, type Db } from "./db/index.js";
import { createLedger } from "./ledger.js";
import { createTakeover, TakeoverError, type Takeover } from "./takeover.js";

let fake: FakeCua;
let dir: string;
let db: Db;
let tk: Takeover;
let computer: Computer;

beforeEach(() => {
  fake = makeFakeCua();
  fake.seed({ "openag-main": "running" });
  dir = mkdtempSync(join(tmpdir(), "openag-takeover-"));
  db = openDb(dir);
  computer = fake.computer();
  tk = createTakeover({ computer, ledger: createLedger(db), checkEveryMs: 3_600_000 });
});
afterEach(() => {
  tk.dispose();
  db.close();
  fake.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const owner = { kind: "owner" } as const;

describe("takeover and agent input", () => {
  it("pauses click/shell with `human has control`, still allows screenshots, and hand-back restores input", async () => {
    await tk.take(owner);
    await expect(computer.act(["click", "1", "2"])).rejects.toMatchObject({ code: "paused", message: "human has control" });
    await expect(computer.shell("echo hi", 5)).rejects.toBeInstanceOf(ComputerError);
    expect((await computer.screenshot()).path).toMatch(/\.png$/);
    tk.release("user");
    expect((await computer.act(["click", "1", "2"])).message).toContain("clicked");
  });

  it("refuses when the sandbox is not running, and does not pause the agent", async () => {
    fake.seed({ "openag-main": "stopped" });
    await expect(tk.take(owner)).rejects.toMatchObject({ code: "not_running" });
    expect(tk.state().active).toBe(false);
  });

  it("another principal is refused with `held`; the same one can refresh", async () => {
    await tk.take({ kind: "device", deviceId: "d1", name: "phone" });
    await expect(tk.take({ kind: "device", deviceId: "d2", name: "tablet" })).rejects.toBeInstanceOf(TakeoverError);
    await expect(tk.take({ kind: "device", deviceId: "d1", name: "phone" })).resolves.toBeDefined();
  });

  it("session ids are single-holder secrets: only live ones check out, and release invalidates them", async () => {
    const { sessionId } = await tk.take(owner);
    expect(tk.checkSession(sessionId)).toBe(true);
    expect(tk.checkSession(sessionId + "x")).toBe(false);
    expect(tk.checkSession(undefined)).toBe(false);
    tk.release("user");
    expect(tk.checkSession(sessionId)).toBe(false);
  });
});

describe("takeover hardening", () => {
  const principal = (id: string) => ({ kind: "device", deviceId: id, name: id }) as const;
  const slowComputer = (tickets: string[], delayMs = 20) => {
    let n = 0;
    return {
      setInputGuard() {},
      viewLink: async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        return { origin: "http://127.0.0.1:1", fragment: `ticket=${tickets[Math.min(n++, tickets.length - 1)]}`, expiresAt: Date.now() + 3_600_000 };
      },
    } as unknown as Computer;
  };
  const make = (c: Computer) => {
    const t = createTakeover({ computer: c, ledger: createLedger(db), checkEveryMs: 3_600_000 });
    return t;
  };

  it("a device revoked while its take is in flight does not end up holding control", async () => {
    const t = make(slowComputer(["a"]));
    const taking = t.take(principal("d1"));
    t.releaseIfHeldBy("d1", "revoked"); // revoke lands during the await
    await expect(taking).rejects.toBeInstanceOf(TakeoverError);
    expect(t.state().active).toBe(false);
    await expect(t.take(principal("d1"))).rejects.toBeInstanceOf(TakeoverError);
    t.dispose();
  });

  it("the holder's ticket survives a link refresh and a losing concurrent take", async () => {
    const t = make(slowComputer(["TA", "TB", "TC"]));
    const [a, b] = await Promise.allSettled([t.take(principal("d1")), t.take(principal("d2"))]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("rejected");
    expect(t.checkTicket("Bearer TA") || t.checkTicket("Bearer TB")).toBe(true);
    const ticket = (a as PromiseFulfilledResult<{ link: { fragment: string } }>).value.link.fragment.split("=")[1]!;
    await t.viewLink(); // refresh for the origin: must not invalidate the holder's ticket
    expect(t.checkTicket(`Bearer ${ticket}`)).toBe(true);
    expect(t.checkTicket("Bearer other")).toBe(false);
    t.dispose();
  });

  it("only the holder or the owner can hand back", async () => {
    const t = make(slowComputer(["a"]));
    await t.take(principal("d1"));
    expect(t.releaseBy(principal("d2"))).toBe(false);
    expect(t.state().active).toBe(true);
    expect(t.releaseBy(principal("d1"))).toBe(true);
    await t.take(principal("d1"));
    expect(t.releaseBy({ kind: "owner" })).toBe(true);
    t.dispose();
  });
});

describe("external live-view links (hosted browsers)", () => {
  const ext = (url: string) =>
    ({
      setInputGuard() {},
      viewLink: async () => ({ kind: "external" as const, url, expiresAt: Date.now() + 1_800_000 }),
    }) as unknown as Computer;
  const make = (c: Computer) => createTakeover({ computer: c, ledger: createLedger(db), checkEveryMs: 3_600_000 });

  it("takes control with an external link: no ticket is registered, the link is returned as is", async () => {
    const t = make(ext("https://live.browserbase.com/view/abc"));
    const { link } = await t.take({ kind: "owner" });
    expect(link).toMatchObject({ kind: "external", url: "https://live.browserbase.com/view/abc" });
    expect(t.state().active).toBe(true);
    expect(t.checkTicket("Bearer anything")).toBe(false);
    t.dispose();
  });

  it.each([
    "http://live.example.com/x",
    "https://user:pw@live.example.com/x",
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://[::1]/x",
    "https://intranet/x",
    "https://printer.local/x",
    "javascript:alert(1)",
    "not a url",
    "https://live.example.com/" + "a".repeat(2100),
  ])("an unsafe live-view link %s is refused and control is not taken", async (url) => {
    const t = make(ext(url));
    await expect(t.take({ kind: "owner" })).rejects.toMatchObject({ message: "unsafe live-view link" });
    expect(t.state().active).toBe(false);
    t.dispose();
  });
});

describe("external takeovers", () => {
  const extLink = (expiresAt: number, url = "https://live.browserbase.com/view/abc") => ({ kind: "external" as const, url, expiresAt });
  const computerWith = (link: ReturnType<typeof extLink>) => ({ setInputGuard() {}, viewLink: async () => link }) as unknown as Computer;

  it("an external takeover is not released by idleness (the viewer reports no activity) but by the link's own expiry", async () => {
    let t = 1_000_000;
    const tk = createTakeover({ computer: computerWith(extLink(t + 600_000)), ledger: createLedger(db), now: () => t, idleMs: 60_000, checkEveryMs: 10 });
    await tk.take({ kind: "owner" });
    t += 300_000; // 5 minutes: far past idleMs, before the link expires
    await new Promise((r) => setTimeout(r, 40));
    expect(tk.state().active).toBe(true);
    t += 400_000; // past the expiry
    await new Promise((r) => setTimeout(r, 40));
    expect(tk.state().active).toBe(false);
    tk.dispose();
  });

  it("release listeners learn the reason and whether the holder used an external link", async () => {
    const tk = createTakeover({ computer: computerWith(extLink(Date.now() + 600_000)), ledger: createLedger(db), checkEveryMs: 3_600_000 });
    const seen: Array<[string, boolean]> = [];
    tk.onRelease((reason, external) => seen.push([reason, external]));
    await tk.take({ kind: "device", deviceId: "d1", name: "phone" });
    tk.releaseIfHeldBy("d1", "revoked");
    expect(seen).toEqual([["revoked", true]]);
    tk.dispose();
  });

  it.each(["https://localhost./", "https://foo.localhost/", "https://printer.local./", "https://intranet./", "https://intranet.corp/", "https://wiki.internal/", "https://router.lan/", "https://nas.home/"])(
    "the hardened URL check refuses %s",
    async (url) => {
      const tk = createTakeover({ computer: computerWith(extLink(Date.now() + 600_000, url)), ledger: createLedger(db), checkEveryMs: 3_600_000 });
      await expect(tk.take({ kind: "owner" })).rejects.toMatchObject({ message: "unsafe live-view link" });
      tk.dispose();
    },
  );
});
