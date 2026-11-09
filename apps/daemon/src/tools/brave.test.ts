import { describe, expect, test, vi } from "vitest";
import { createBraveTool } from "./brave.js";
import { toExecutors } from "./registry.js";

const KEY = "sekrit-key-123";
const ctx = { botId: "boss", dataDir: "/nonexistent" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(opts: { key?: string | undefined; response?: () => Response | Promise<Response> } = {}) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    opts.response ? opts.response() : jsonResponse({ web: { results: [] } }),
  );
  const tool = createBraveTool({
    fetch: fetchMock as unknown as typeof fetch,
    apiKey: () => ("key" in opts ? opts.key : KEY),
  });
  return { tool, fetchMock, exec: toExecutors([tool]).brave_search! };
}

describe("enabled", () => {
  test("disabled without a key or with a blank key, and execute makes zero fetch calls", async () => {
    for (const key of [undefined, "", "   "]) {
      const { tool, fetchMock, exec } = setup({ key });
      expect(tool.enabled!()).toBe(false);
      await expect(exec(ctx, { query: "x" })).rejects.toThrow("tool brave_search is not enabled");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  test("enabled with a non-empty key", () => {
    expect(setup().tool.enabled!()).toBe(true);
  });
});

describe("request", () => {
  test("builds the exact URL with encoded query and default count 5, key in header only", async () => {
    const { fetchMock, exec } = setup();
    await exec(ctx, { query: "a b&c=d" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.search.brave.com/res/v1/web/search?q=a+b%26c%3Dd&count=5");
    expect(String(url)).not.toContain(KEY);
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Subscription-Token"]).toBe(KEY);
    expect(headers.Accept).toBe("application/json");
    expect(init!.signal).toBeDefined();
  });

  test("explicit count is passed through", async () => {
    const { fetchMock, exec } = setup();
    await exec(ctx, { query: "q", count: 10 });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("count=10");
  });

  test.each([0, 11, 2.5, "3"])("invalid count %s is rejected before any fetch", async (count) => {
    const { fetchMock, exec } = setup();
    await expect(exec(ctx, { query: "q", count })).rejects.toThrow(/invalid arguments for brave_search/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each(["", "x".repeat(401)])("invalid query length is rejected before any fetch", async (query) => {
    const { fetchMock, exec } = setup();
    await expect(exec(ctx, { query })).rejects.toThrow(/invalid arguments for brave_search/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("result mapping", () => {
  test("maps results, marks them untrusted, and includes the notice", async () => {
    const { exec } = setup({
      response: () => jsonResponse({ web: { results: [{ title: "T", url: "https://e.x", description: "D", extra: 1 }] } }),
    });
    const out = (await exec(ctx, { query: "q" })) as Record<string, unknown>;
    expect(out).toMatchObject({ untrusted: true, source: "brave", results: [{ title: "T", url: "https://e.x", description: "D" }] });
    expect(String(out.notice)).toMatch(/untrusted/);
  });

  test("caps title, description and result count", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: "t".repeat(500) + i,
      url: `https://e.x/${i}`,
      description: "d".repeat(2000),
    }));
    const { exec } = setup({ response: () => jsonResponse({ web: { results: many } }) });
    const out = (await exec(ctx, { query: "q", count: 3 })) as { results: { title: string; description: string }[] };
    expect(out.results).toHaveLength(3);
    expect(out.results[0]!.title).toHaveLength(200);
    expect(out.results[0]!.description).toHaveLength(500);
  });

  test("total serialized size is capped by dropping trailing results", async () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ title: "t".repeat(200), url: `https://e.x/${i}`, description: "d".repeat(500) }));
    const { exec } = setup({ response: () => jsonResponse({ web: { results: big } }) });
    const out = await exec(ctx, { query: "q", count: 10 });
    const size = JSON.stringify(out).length;
    expect(size).toBeLessThanOrEqual(6000);
    expect((out as { results: unknown[] }).results.length).toBeGreaterThan(0);
    expect((out as { results: unknown[] }).results.length).toBeLessThan(10);
  });

  test("tolerates a missing web.results", async () => {
    const { exec } = setup({ response: () => jsonResponse({}) });
    expect(await exec(ctx, { query: "q" })).toMatchObject({ results: [] });
  });
});

describe("errors never leak the key or body", () => {
  test.each([401, 429, 500])("HTTP %i throws a status-only error", async (status) => {
    const { exec } = setup({ response: () => new Response(`bad ${KEY} body`, { status }) });
    const err = await exec(ctx, { query: "q" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(`Brave search failed: HTTP ${status}`);
    expect((err as Error).message).not.toContain(KEY);
  });

  test("network/timeout error surfaces without the key or URL", async () => {
    const { exec } = setup({
      response: () => {
        const e = new Error(`failed for ${KEY}`);
        e.name = "TimeoutError";
        throw e;
      },
    });
    const err = (await exec(ctx, { query: "q" }).catch((e: Error) => e)) as Error;
    expect(err.message).toBe("Brave search request failed: TimeoutError");
    expect(err.message).not.toContain(KEY);
  });

  test("passes a timeout signal that aborts a hung request", async () => {
    const tool = createBraveTool({
      apiKey: () => KEY,
      timeoutMs: 20,
      fetch: ((_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener("abort", () => rej(init.signal!.reason));
        })) as unknown as typeof fetch,
    });
    const err = (await toExecutors([tool]).brave_search!(ctx, { query: "q" }).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/^Brave search request failed: /);
    expect(err.message).not.toContain(KEY);
  });
});
