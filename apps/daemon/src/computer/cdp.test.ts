import { describe, expect, test } from "vitest";
import { type CdpSocket, createCdp } from "./cdp.js";

class FakeSocket implements CdpSocket {
  sent: Array<{ id: number; method: string; params?: unknown; sessionId?: string }> = [];
  private msg: ((d: string) => void) | null = null;
  private closeCb: (() => void) | null = null;
  private openCb: (() => void) | null = null;
  autoReply: ((m: { id: number; method: string; params?: any }) => unknown) | null = null;
  send(data: string): void {
    const m = JSON.parse(data);
    this.sent.push(m);
    const reply = this.autoReply?.(m);
    if (reply !== undefined) this.reply(reply as object);
  }
  onMessage(cb: (d: string) => void) {
    this.msg = cb;
  }
  onClose(cb: () => void) {
    this.closeCb = cb;
  }
  onOpen(cb: () => void) {
    this.openCb = cb;
  }
  close() {
    this.closeCb?.();
  }
  open() {
    this.openCb?.();
  }
  reply(obj: object) {
    this.msg?.(JSON.stringify(obj));
  }
  drop() {
    this.closeCb?.();
  }
}

async function connected(replies?: FakeSocket["autoReply"], timeoutMs?: number) {
  const sock = new FakeSocket();
  sock.autoReply = replies ?? null;
  const cdp = createCdp(() => sock, timeoutMs);
  const p = cdp.connect("wss://connect.browserbase.com/x");
  sock.open();
  await p;
  return { cdp, sock };
}

describe("cdp client", () => {
  test("matches responses to requests by id and passes sessionId", async () => {
    const { cdp, sock } = await connected();
    const a = cdp.send("Page.navigate", { url: "https://a.test" }, "S1");
    const b = cdp.send("Runtime.evaluate", {});
    sock.reply({ id: 2, result: { two: true } });
    sock.reply({ id: 1, result: { one: true } });
    expect(await a).toEqual({ one: true });
    expect(await b).toEqual({ two: true });
    expect(sock.sent[0]).toMatchObject({ method: "Page.navigate", sessionId: "S1" });
    expect(sock.sent[1].sessionId).toBeUndefined();
  });

  test("a CDP error rejects with a fixed message that does not echo the server text", async () => {
    const { cdp, sock } = await connected();
    const p = cdp.send("Bogus.method");
    sock.reply({ id: 1, error: { code: -32601, message: "wss://secret.browserbase.com/?key=abc" } });
    const err = await p.catch((e: Error) => e);
    expect(err.message).toBe("cdp error");
    expect(String(err.message)).not.toContain("secret");
  });

  test("a timed-out call rejects with cdp timeout", async () => {
    const { cdp } = await connected(undefined, 10);
    await expect(cdp.send("Page.enable")).rejects.toThrow("cdp timeout");
  });

  test("socket close rejects pending calls and later calls fail fast", async () => {
    const { cdp, sock } = await connected();
    const p = cdp.send("Page.enable");
    sock.drop();
    await expect(p).rejects.toThrow("cdp socket closed");
    await expect(cdp.send("Page.enable")).rejects.toThrow("cdp not connected");
  });

  test("connect rejects with a fixed message when the socket closes before opening", async () => {
    const sock = new FakeSocket();
    const cdp = createCdp(() => sock);
    const p = cdp.connect("wss://connect.browserbase.com/x");
    sock.drop();
    await expect(p).rejects.toThrow("cdp connect failed");
  });

  test("close() rejects pending calls", async () => {
    const { cdp } = await connected();
    const p = cdp.send("Page.enable");
    cdp.close();
    await expect(p).rejects.toThrow("cdp closed");
  });

  test("attachFirstPage uses the first page target and returns the flat session id", async () => {
    const methods: string[] = [];
    const { cdp } = await connected((m) => {
      methods.push(m.method);
      if (m.method === "Target.getTargets")
        return { id: m.id, result: { targetInfos: [{ type: "service_worker", targetId: "W" }, { type: "page", targetId: "P1" }, { type: "page", targetId: "P2" }] } };
      if (m.method === "Target.attachToTarget") return { id: m.id, result: { sessionId: "SESS" } };
      return undefined;
    });
    expect(await cdp.attachFirstPage()).toBe("SESS");
    expect(methods).toEqual(["Target.getTargets", "Target.attachToTarget"]);
  });

  test("attachFirstPage creates about:blank when there is no page target", async () => {
    const seen: any[] = [];
    const { cdp } = await connected((m) => {
      seen.push(m);
      if (m.method === "Target.getTargets") return { id: m.id, result: { targetInfos: [] } };
      if (m.method === "Target.createTarget") return { id: m.id, result: { targetId: "NEW" } };
      if (m.method === "Target.attachToTarget") return { id: m.id, result: { sessionId: "S" } };
      return undefined;
    });
    expect(await cdp.attachFirstPage()).toBe("S");
    expect(seen.find((m) => m.method === "Target.createTarget").params).toEqual({ url: "about:blank" });
    expect(seen.find((m) => m.method === "Target.attachToTarget").params).toEqual({ targetId: "NEW", flatten: true });
  });

  test("attachFirstPage rejects when no session id comes back", async () => {
    const { cdp } = await connected((m) => ({ id: m.id, result: m.method === "Target.getTargets" ? { targetInfos: [{ type: "page", targetId: "P" }] } : {} }));
    await expect(cdp.attachFirstPage()).rejects.toThrow("cdp attach failed");
  });
});
