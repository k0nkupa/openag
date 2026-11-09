import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Db, openDb } from "./db/index.js";
import { createRedactor } from "./redact.js";
import { chunkText, createOllamaEmbedder, createVectorMemory, type Embedder } from "./vectors.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-vectors-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const redactor = createRedactor({ env: {} });
const SECRET = `sk-${"a".repeat(30)}`;

/** Deterministic bag-of-words: each lower-cased word lands in one of `dim` buckets. */
function fake(model = "fake-a", dim = 16, opts: { fail?: boolean; slow?: boolean } = {}): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model,
    calls,
    async embed(texts: string[]) {
      calls.push(texts);
      if (opts.fail) throw new Error("embedding failed: HTTP 500");
      if (opts.slow) return new Promise<number[][]>(() => undefined);
      return texts.map((t) => {
        const v = new Array<number>(dim).fill(0);
        for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          let h = 0;
          for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 1000003;
          v[h % dim] += 1;
        }
        if (v.every((x) => x === 0)) v[0] = 1;
        const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        return v.map((x) => x / n);
      });
    },
  };
}

const vm = (embedder: Embedder, extra: { maxDistance?: number; searchBudgetMs?: number } = {}) =>
  createVectorMemory({ db, embedder, redactor, ...extra });

const rows = () => db.prepare("SELECT * FROM memory_chunks ORDER BY id").all() as Record<string, unknown>[];
const vecCount = (dim: number) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM vec_chunks_${dim}`).get() as { n: number }).n;

describe("chunkText", () => {
  test("splits on headings and paragraphs, skips heading-only text", () => {
    const chunks = chunkText("# Title\n\n## Facts\n\nThe user lives in Wellington and likes tea.\n\n## Empty\n");
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("Wellington");
    expect(chunkText("# Only\n\n## Headings\n")).toEqual([]);
  });

  test("caps chunk size", () => {
    const long = Array.from({ length: 300 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1600);
  });
});

describe("index + search", () => {
  test("returns the most similar chunk first and stores model and dim", async () => {
    const e = fake();
    const m = vm(e);
    m.indexMemoryFile("boss", "The user prefers green tea in the morning.\n\nThe office printer is on floor two.");
    // Neighbouring paragraphs merge into one chunk while they fit under the size cap.
    expect(await m.embedPending()).toBe(1);
    const hits = await m.search("boss", "what tea does the user prefer", 2);
    expect(hits[0].text).toContain("green tea");
    expect(hits[0].source).toBe("memory");
    const stored = rows();
    expect(stored.every((r) => r.embedding_model === "fake-a" && r.dim === 16)).toBe(true);
    expect(vecCount(16)).toBe(1);
  });

  test("bot isolation: another bot's chunk is never returned", async () => {
    const m = vm(fake());
    m.indexTurn("coder", "t1", "deploy the staging server", "done, staging is up");
    m.indexTurn("boss", "t2", "unrelated question", "unrelated answer");
    await m.embedPending();
    const hits = await m.search("boss", "deploy the staging server");
    expect(hits.every((h) => !h.text.includes("staging"))).toBe(true);
  });

  test("duplicates are deduped by hash", () => {
    const m = vm(fake());
    m.indexMemoryFile("boss", "The user likes tea.");
    m.indexMemoryFile("boss", "The user likes tea.");
    expect(rows()).toHaveLength(1);
  });

  test("editing MEMORY.md removes stale chunks and their vec rows", async () => {
    const m = vm(fake());
    const pad = " filler words here to keep the section above the merge threshold".repeat(4);
    const alpha = `## Kittens\n\nAlpha fact about kittens.${pad}`;
    const beta = `## Rivers\n\nBeta fact about rivers.${pad}`;
    const gamma = `## Mountains\n\nGamma fact about mountains.${pad}`;
    m.indexMemoryFile("boss", `${alpha}\n\n${beta}`);
    await m.embedPending();
    expect(vecCount(16)).toBe(2);
    m.indexMemoryFile("boss", `${beta}\n\n${gamma}`);
    await m.embedPending();
    const texts = rows().map((r) => String(r.text));
    expect(texts.some((t) => t.includes("Alpha fact about kittens"))).toBe(false);
    expect(texts).toHaveLength(2);
    expect(vecCount(16)).toBe(2);
  });

  test("maxDistance cuts off weak matches", async () => {
    const m = vm(fake(), { maxDistance: 0.6 });
    m.indexTurn("boss", "t1", "alpha beta gamma", "delta");
    await m.embedPending();
    expect(await m.search("boss", "zebra quartz")).toEqual([]);
    expect((await m.search("boss", "alpha beta gamma")).length).toBe(1);
  });
});

describe("fail soft", () => {
  test("a throwing embedder leaves chunks pending, returns 0, and logs at most once a minute", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = vm(fake("fake-a", 16, { fail: true }));
    m.indexTurn("boss", "t1", "q1", "a1");
    m.indexTurn("boss", "t2", "q2", "a2");
    expect(await m.embedPending()).toBe(0);
    expect(await m.embedPending()).toBe(0);
    expect(await m.embedPending()).toBe(0);
    expect(rows().every((r) => r.embedding_model === null)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).not.toContain("q1");
    expect(await m.search("boss", "q1")).toEqual([]);
  });

  test("a slow embedder makes search return [] within the budget", async () => {
    const m = vm(fake("fake-a", 16, { slow: true }), { searchBudgetMs: 50 });
    const start = Date.now();
    expect(await m.search("boss", "anything")).toEqual([]);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("a slow embedder with the default budget resolves within ~3 s", async () => {
    vi.useFakeTimers();
    try {
      const m = vm(fake("fake-a", 16, { slow: true }));
      const p = m.search("boss", "anything");
      await vi.advanceTimersByTimeAsync(3100);
      expect(await p).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("model change", () => {
  test("re-embeds under the new model: old vec row removed, new one in its own dimension", async () => {
    const a = fake("model-a", 16);
    const b = fake("model-b", 8);
    vm(a).indexTurn("boss", "t1", "green tea morning", "yes");
    await vm(a).embedPending();
    expect(vecCount(16)).toBe(1);

    const mb = vm(b);
    expect(await mb.embedPending()).toBe(1);
    expect(vecCount(16)).toBe(0);
    expect(vecCount(8)).toBe(1);
    expect(rows()[0]).toMatchObject({ embedding_model: "model-b", dim: 8 });
    expect((await mb.search("boss", "green tea morning"))[0].text).toContain("green tea");
  });
});

describe("redaction", () => {
  test("secrets never reach memory_chunks.text or the embedder", async () => {
    const e = fake();
    const embedSpy = vi.spyOn(e, "embed");
    const m = vm(e);
    m.indexMemoryFile("boss", `The api key is ${SECRET} for the mailer.`);
    m.indexTurn("boss", "t1", `use ${SECRET} please`, `ok ${SECRET}`);
    await m.embedPending();
    const stored = JSON.stringify(rows());
    expect(stored).not.toContain(SECRET);
    expect(stored).toContain("[REDACTED");
    const sent = embedSpy.mock.calls.flatMap((c) => c[0]).join("\n");
    expect(sent).not.toContain(SECRET);
    await m.search("boss", `query ${SECRET}`);
    expect(embedSpy.mock.calls.flatMap((c) => c[0]).join("\n")).not.toContain(SECRET);
  });
});

describe("SQL safety", () => {
  test.each([
    ["empty vector", () => []],
    ["absurd dimension", () => Array.from({ length: 100000 }, (_, i) => (i === 0 ? 1 : 0))],
    ["oversize dimension", () => Array.from({ length: 8193 }, (_, i) => (i === 0 ? 1 : 0))],
    ["NaN component", () => [Number.NaN, 0.5]],
  ])("%s fails soft and runs no SQL built from it", async (_name, makeVec) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad: Embedder = { model: "bad", async embed(texts) { return texts.map(() => makeVec()); } };
    const execSpy = vi.spyOn(db, "exec");
    const prepSpy = vi.spyOn(db, "prepare");
    const m = vm(bad);
    m.indexTurn("boss", "t1", "q", "a");
    expect(await m.embedPending()).toBe(0);
    const sql = [...execSpy.mock.calls.map((c) => String(c[0])), ...prepSpy.mock.calls.map((c) => String(c[0]))];
    expect(sql.some((s) => /vec0|vec_chunks_\d/.test(s))).toBe(false);
    expect(rows()[0]).toMatchObject({ embedding_model: null });
  });
});

describe("ollama embedder", () => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  test("posts the expected request and normalises vectors", async () => {
    const fetchMock = vi.fn(async () => ok({ model: "m", embeddings: [[3, 4]] }));
    const e = createOllamaEmbedder({ model: "m", fetch: fetchMock as unknown as typeof fetch });
    const out = await e.embed(["hello"]);
    expect(out).toEqual([[0.6, 0.8]]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/embed");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ model: "m", input: ["hello"], truncate: true });
    expect(init.signal).toBeDefined();
  });

  test("uses the custom base url when given", async () => {
    const fetchMock = vi.fn(async () => ok({ embeddings: [[1]] }));
    await createOllamaEmbedder({ baseUrl: "http://x:1", model: "m", fetch: fetchMock as unknown as typeof fetch }).embed(["a"]);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("http://x:1/api/embed");
  });

  test("errors never contain the input text", async () => {
    const secretText = "PRIVATE-INPUT-TEXT-XYZ";
    const cases: Array<() => typeof fetch> = [
      () => (async () => ok({ error: "model 'x' not found" })) as unknown as typeof fetch,
      () => (async () => ok({ error: "model 'x' not found" }, 404)) as unknown as typeof fetch,
      () => (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
      () => (async () => ok({ embeddings: [[1, 2]], extra: secretText }, 200).clone() && ok({ wrong: true })) as unknown as typeof fetch,
      () => (async () => ok({ embeddings: [] })) as unknown as typeof fetch,
      () => (async () => { throw Object.assign(new Error(secretText), { name: "TimeoutError" }); }) as unknown as typeof fetch,
      () => (async () => { throw Object.assign(new Error(secretText), { name: "AbortError" }); }) as unknown as typeof fetch,
    ];
    for (const make of cases) {
      const e = createOllamaEmbedder({ model: "x", fetch: make() });
      const err = await e.embed([secretText]).then(
        () => null,
        (x: Error) => x,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err!.message.startsWith("embedding failed:")).toBe(true);
      expect(err!.message).not.toContain(secretText);
    }
  });

  test("model not found surfaces Ollama's message", async () => {
    const e = createOllamaEmbedder({ model: "x", fetch: (async () => ok({ error: "model 'x' not found" })) as unknown as typeof fetch });
    await expect(e.embed(["a"])).rejects.toThrow("embedding failed: model 'x' not found");
  });

  test("timeout maps to a short reason", async () => {
    const e = createOllamaEmbedder({
      model: "x",
      fetch: (async () => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }) as unknown as typeof fetch,
    });
    await expect(e.embed(["a"])).rejects.toThrow("embedding failed: timeout");
  });
});
