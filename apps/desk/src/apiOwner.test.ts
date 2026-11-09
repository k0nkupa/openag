import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApi, whoamiWithToken } from "./api";
import { clearOwnerToken, getOwnerToken, setOwnerToken } from "./ownerSession";

const DEVICE = "device-token-xyz";
const OWNER = "owner-token-123";

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function authOf(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

const REFUSED = () => json(403, { error: "owner token required" });

describe("createApi owner retry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOwnerToken();
  });

  it("retries an owner-only refusal once with the held owner token", async () => {
    setOwnerToken(OWNER);
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      authOf(init) === `Bearer ${OWNER}` ? json(200, { ok: true, ran: true }) : REFUSED(),
    );
    const api = createApi(DEVICE, () => {}, fetchMock as unknown as typeof fetch);
    const result = await api.runBackup();
    expect(result).toEqual({ ok: true, ran: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [path1, init1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [path2, init2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(path1).toBe("/backups/run");
    expect(path2).toBe("/backups/run");
    expect(init1.method).toBe("POST");
    expect(init2.method).toBe("POST");
    expect(authOf(init1)).toBe(`Bearer ${DEVICE}`);
    expect(authOf(init2)).toBe(`Bearer ${OWNER}`);
  });

  it("retries the blob helper too", async () => {
    setOwnerToken(OWNER);
    const fetchMock = vi.fn(async (_p: string, init?: RequestInit) =>
      authOf(init) === `Bearer ${OWNER}` ? new Response("png", { status: 200 }) : REFUSED(),
    );
    const blob = await createApi(DEVICE, () => {}, fetchMock as unknown as typeof fetch).computerScreenshot();
    expect(await blob.text()).toBe("png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry without a held owner token and keeps the unlock hint", async () => {
    const fetchMock = vi.fn(async () => REFUSED());
    const err = await createApi(DEVICE, () => {}, fetchMock as unknown as typeof fetch)
      .runBackup()
      .catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe("owner token required. Full access is required. Ask a trusted Full access device, or run pnpm desk:open on the daemon host.");
  });

  it("does not retry other 403s", async () => {
    setOwnerToken(OWNER);
    const fetchMock = vi.fn(async () => json(403, { error: "forbidden" }));
    const err = await createApi(DEVICE, () => {}, fetchMock as unknown as typeof fetch)
      .runBackup()
      .catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((err as ApiError).message).toBe("forbidden");
  });

  it("does not retry in rtc mode (ownerRetry false)", async () => {
    setOwnerToken(OWNER);
    const fetchMock = vi.fn(async () => REFUSED());
    const api = createApi(DEVICE, () => {}, fetchMock as unknown as typeof fetch, { ownerRetry: false });
    await expect(api.applyReadiness()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getOwnerToken()).toBe(OWNER);
  });

  it("clears the held token when the retry is 401 and surfaces the original refusal", async () => {
    setOwnerToken(OWNER);
    const fetchMock = vi.fn(async (_p: string, init?: RequestInit) =>
      authOf(init) === `Bearer ${OWNER}` ? json(401, { error: "unauthorized" }) : REFUSED(),
    );
    const onUnauthorized = vi.fn();
    const err = await createApi(DEVICE, onUnauthorized, fetchMock as unknown as typeof fetch)
      .deleteAutomation("a1")
      .catch((e: unknown) => e);
    expect(getOwnerToken()).toBeNull();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect((err as ApiError).status).toBe(403);
  });

  it("never sends the owner token to an unauthenticated route", async () => {
    setOwnerToken(OWNER);
    const fetchMock = vi.fn(async () => json(200, { ok: true, vec_version: "v0" }));
    await createApi(DEVICE, () => {}, fetchMock as unknown as typeof fetch).health();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authOf((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1])).toBeUndefined();
  });
});

describe("whoamiWithToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers the kind for a candidate token", async () => {
    const fetchMock = vi.fn(async () => json(200, { kind: "owner" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(whoamiWithToken(OWNER)).resolves.toEqual({ kind: "owner" });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/whoami");
    expect(authOf(init)).toBe(`Bearer ${OWNER}`);
  });
});
