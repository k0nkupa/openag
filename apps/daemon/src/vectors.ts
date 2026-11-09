import { createHash } from "node:crypto";
import type { Db } from "./db/index.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";

export interface Embedder {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const MAX_CHUNK = 1600;
const MIN_CHUNK = 12;
const MAX_DIM = 8192;
const MAX_TURN_PART = 1000;
const MAX_QUERY = 2000;
const LOG_INTERVAL_MS = 60_000;

function unit(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (!(norm > 0)) throw new Error("embedding failed: invalid response");
  return v.map((x) => x / norm);
}

/** Short, input-free reason for a failed request. */
function fetchReason(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "request failed";
}

export function createOllamaEmbedder(opts: {
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
} = {}): Embedder {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts.model ?? (process.env.OPENAG_EMBED_MODEL || "nomic-embed-text");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30000;
  return {
    model,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/api/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, input: texts, truncate: true }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new Error(`embedding failed: ${fetchReason(err)}`);
      }
      if (!res.ok) throw new Error(`embedding failed: HTTP ${res.status}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new Error("embedding failed: invalid response");
      }
      const b = body as { error?: unknown; embeddings?: unknown };
      if (typeof b?.error === "string") throw new Error(`embedding failed: ${b.error.slice(0, 120)}`);
      if (!Array.isArray(b?.embeddings) || b.embeddings.length !== texts.length) {
        throw new Error("embedding failed: invalid response");
      }
      return b.embeddings.map((v) => {
        if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
          throw new Error("embedding failed: invalid response");
        }
        return unit(v as number[]);
      });
    },
  };
}

export interface VectorMemory {
  indexMemoryFile(botId: string, text: string): void;
  indexTurn(botId: string, turnId: string, question: string, answer: string): void;
  embedPending(limit?: number): Promise<number>;
  search(botId: string, query: string, k?: number): Promise<{ text: string; source: string; distance: number }[]>;
}

export interface VectorMemoryDeps {
  db: Db;
  embedder: Embedder;
  redactor?: Redactor;
  maxDistance?: number;
  /** Time budget for embedding a query in search(). Default 3000 ms. */
  searchBudgetMs?: number;
}

const validDim = (d: unknown): d is number => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= MAX_DIM;
const vecTable = (dim: number) => `vec_chunks_${dim}`; // only ever called with a validDim() integer

/** Splits a markdown file into retrieval chunks: headings attach to the body that follows them. */
export function chunkText(text: string): string[] {
  const isHeading = (line: string) => /^#{1,6}\s/.test(line);
  const blocks: { text: string; heading: boolean }[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) blocks.push({ text: para.join("\n").trim(), heading: false });
    para = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") flush();
    else if (isHeading(line)) {
      flush();
      blocks.push({ text: line.trim(), heading: true });
    } else para.push(line);
  }
  flush();

  const chunks: string[] = [];
  let cur = "";
  let curBody = false;
  const push = () => {
    if (curBody && cur.trim().length >= MIN_CHUNK) chunks.push(cur.trim());
    cur = "";
    curBody = false;
  };
  for (const block of blocks) {
    for (const piece of splitLong(block.text)) {
      if (block.heading) {
        // A heading closes the section only once it has enough body; short sections merge with their neighbours.
        if (curBody && cur.length >= 200) push();
        cur = cur ? `${cur}\n\n${piece}` : piece;
      } else {
        if (cur && cur.length + 2 + piece.length > MAX_CHUNK) push();
        cur = cur ? `${cur}\n\n${piece}` : piece;
        curBody = true;
      }
    }
  }
  push();
  return chunks;
}

function splitLong(block: string): string[] {
  if (block.length <= MAX_CHUNK) return [block];
  const out: string[] = [];
  let cur = "";
  const pieces = block.split(/(?<=[.!?])\s+|\n/);
  for (let piece of pieces) {
    while (piece.length > MAX_CHUNK) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      out.push(piece.slice(0, MAX_CHUNK));
      piece = piece.slice(MAX_CHUNK);
    }
    if (!piece) continue;
    if (cur && cur.length + 1 + piece.length > MAX_CHUNK) {
      out.push(cur);
      cur = piece;
    } else cur = cur ? `${cur} ${piece}` : piece;
  }
  if (cur) out.push(cur);
  return out;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createVectorMemory(deps: VectorMemoryDeps): VectorMemory {
  const { db, embedder } = deps;
  const redactor = deps.redactor ?? getDefaultRedactor();
  const maxDistance = deps.maxDistance ?? 1.1;
  const searchBudgetMs = deps.searchBudgetMs ?? 3000;

  let lastLog = -Infinity;
  const logError = (where: string, err: unknown) => {
    const now = Date.now();
    if (now - lastLog < LOG_INTERVAL_MS) return;
    lastLog = now;
    const reason = err instanceof Error ? err.message : "unknown error";
    console.error(`vector memory ${where} failed (will retry): ${reason}`);
  };

  const tableExists = (dim: number): boolean =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(vecTable(dim));

  function dropVec(id: number, dim: unknown): void {
    if (!validDim(dim) || !tableExists(dim)) return;
    db.prepare(`DELETE FROM ${vecTable(dim)} WHERE rowid = ?`).run(BigInt(id));
  }

  const insertChunk = db.prepare(
    `INSERT OR IGNORE INTO memory_chunks (bot_id, source, source_ref, text, content_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  function indexMemoryFile(botId: string, text: string): void {
    try {
      const chunks = chunkText(text).map((c) => redactor.redactString(c));
      const hashes = chunks.map((c) => sha256(c));
      const now = Date.now();
      db.transaction(() => {
        chunks.forEach((c, i) => insertChunk.run(botId, "memory", "MEMORY.md", c, hashes[i], now));
        const keep = new Set(hashes);
        const stale = db
          .prepare("SELECT id, content_hash, dim FROM memory_chunks WHERE bot_id = ? AND source = 'memory' AND source_ref = 'MEMORY.md'")
          .all(botId) as { id: number; content_hash: string; dim: number | null }[];
        for (const row of stale) {
          if (keep.has(row.content_hash)) continue;
          dropVec(row.id, row.dim);
          db.prepare("DELETE FROM memory_chunks WHERE id = ?").run(row.id);
        }
      })();
    } catch (err) {
      logError("memory indexing", err);
    }
  }

  function indexTurn(botId: string, turnId: string, question: string, answer: string): void {
    try {
      const q = redactor.redactString(question).slice(0, MAX_TURN_PART);
      const a = redactor.redactString(answer).slice(0, MAX_TURN_PART);
      const text = `Q: ${q}\nA: ${a}`;
      insertChunk.run(botId, "thread", turnId, text, sha256(text), Date.now());
    } catch (err) {
      logError("turn indexing", err);
    }
  }

  async function embedBatch(limit: number): Promise<number> {
    const rows = db
      .prepare(
        "SELECT id, text, dim, embedding_model FROM memory_chunks WHERE embedding_model IS NULL OR embedding_model != ? ORDER BY id LIMIT ?",
      )
      .all(embedder.model, limit) as { id: number; text: string; dim: number | null; embedding_model: string | null }[];
    if (rows.length === 0) return 0;

    const vectors = await embedder.embed(rows.map((r) => r.text));
    if (!Array.isArray(vectors) || vectors.length !== rows.length) throw new Error("embedding failed: count mismatch");
    const dim = vectors[0]?.length;
    if (!validDim(dim)) throw new Error("embedding failed: bad dimension");
    const units = vectors.map((v) => {
      if (!Array.isArray(v) || v.length !== dim || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
        throw new Error("embedding failed: bad vector");
      }
      return unit(v);
    });

    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${vecTable(dim)} USING vec0(embedding float[${dim}])`);
    const insertVec = db.prepare(`INSERT INTO ${vecTable(dim)}(rowid, embedding) VALUES (?, ?)`);
    const deleteNew = db.prepare(`DELETE FROM ${vecTable(dim)} WHERE rowid = ?`);
    const update = db.prepare("UPDATE memory_chunks SET embedding_model = ?, dim = ? WHERE id = ?");
    db.transaction(() => {
      rows.forEach((row, i) => {
        if (row.embedding_model !== null) dropVec(row.id, row.dim);
        deleteNew.run(BigInt(row.id));
        insertVec.run(BigInt(row.id), Buffer.from(new Float32Array(units[i]).buffer));
        update.run(embedder.model, dim, row.id);
      });
    })();
    return rows.length;
  }

  // Calls run one after another so an overlapping call cannot embed the same rows twice.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    indexMemoryFile,
    indexTurn,

    embedPending(limit = 32): Promise<number> {
      const n = Math.max(1, Math.floor(limit));
      const run = queue.then(() => embedBatch(n));
      queue = run.catch(() => undefined);
      return run.catch((err: unknown) => {
        logError("embedding", err);
        return 0;
      });
    },

    async search(botId, query, k = 4) {
      try {
        const q = redactor.redactString(query).slice(0, MAX_QUERY);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const budget = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("embedding budget exceeded")), searchBudgetMs);
        });
        let qv: number[][];
        try {
          qv = await Promise.race([embedder.embed([q]), budget]);
        } finally {
          clearTimeout(timer);
        }
        const v = qv[0];
        const dim = v?.length;
        if (!validDim(dim) || !tableExists(dim)) return [];
        const queryVec = unit(v);
        const rows = db
          .prepare(`SELECT rowid, distance FROM ${vecTable(dim)} WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
          .all(Buffer.from(new Float32Array(queryVec).buffer), Math.max(50, k * 10)) as { rowid: number; distance: number }[];
        const pick = db.prepare(
          "SELECT text, source FROM memory_chunks WHERE id = ? AND bot_id = ? AND embedding_model = ?",
        );
        const out: { text: string; source: string; distance: number }[] = [];
        for (const r of rows) {
          if (out.length >= k) break;
          if (r.distance > maxDistance) break;
          const chunk = pick.get(Number(r.rowid), botId, embedder.model) as { text: string; source: string } | undefined;
          if (chunk) out.push({ text: chunk.text, source: chunk.source, distance: r.distance });
        }
        return out;
      } catch (err) {
        logError("search", err);
        return [];
      }
    },
  };
}
