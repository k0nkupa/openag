import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createMcpManager } from "./mcp.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-mcp-reserved-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a user server with the id openag is reported invalid and never connects", async () => {
  const path = join(dir, "mcp.json");
  writeFileSync(path, JSON.stringify({ servers: [{ id: "openag", transport: "http", url: "https://example.com/mcp" }] }));
  chmodSync(path, 0o600);
  let connects = 0;
  const mgr = createMcpManager({
    dataDir: dir,
    connector: async () => {
      connects++;
      throw new Error("must not connect");
    },
  });
  await mgr.load();
  expect(mgr.status()).toEqual([
    expect.objectContaining({ id: "openag", state: "invalid", detail: 'invalid: id "openag" is reserved' }),
  ]);
  expect(connects).toBe(0);
  await mgr.close();
});
