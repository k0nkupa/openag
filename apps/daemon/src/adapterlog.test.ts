import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createAdapterLog } from "./adapterlog.js";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "openag-adlog-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("lines go to a private log file and a short tail; env is recorded as key names only", () => {
  const log = createAdapterLog(dir, "boss");
  log.setProcess(123, ["PATH", "HOME", "ANOTHER"]);
  for (let i = 0; i < 60; i++) log.line(`line ${i}\n`);
  log.setExit(null, "SIGKILL");
  const d = log.diagnostics();
  expect(d).toMatchObject({ pid: 123, envKeys: ["ANOTHER", "HOME", "PATH"], exit: { code: null, signal: "SIGKILL" } });
  expect(d.lines).toHaveLength(20);
  expect(d.lines.at(-1)).toBe("line 59");
  const file = join(dir, "logs", "adapter-boss.log");
  expect(readFileSync(file, "utf8")).toContain("[exit] code=null signal=SIGKILL");
  expect(statSync(file).mode & 0o077).toBe(0);
  expect(statSync(join(dir, "logs")).mode & 0o077).toBe(0);
});

test("the log is size-capped by rotation and long lines are clipped; odd bot ids cannot escape the logs dir", () => {
  const log = createAdapterLog(dir, "../../evil", 2000);
  for (let i = 0; i < 100; i++) log.line("x".repeat(100));
  expect(existsSync(join(dir, "logs", "adapter-______evil.log.1"))).toBe(true);
  expect(statSync(join(dir, "logs", "adapter-______evil.log")).size).toBeLessThan(2000 + 200);
  log.line("y".repeat(5000));
  expect(log.diagnostics().lines.at(-1)!.length).toBe(500);
});
