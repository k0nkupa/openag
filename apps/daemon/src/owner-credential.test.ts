import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveOwnerCredential } from "./owner-credential.js";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "oag-credential-"));
  directories.push(dir);
  const token = resolveOwnerCredential(dir), file = join(dir, ".owner/credential.json");
  return { dir, token, file, stage: join(dir, ".owner", `.${randomUUID()}.tmp`) };
}

it("recovers an interrupted publication without replacing the existing credential", () => {
  const { dir, token, file, stage } = fixture(), before = readFileSync(file);
  const inode = statSync(file).ino;
  linkSync(file, stage);
  expect(statSync(file).nlink).toBe(2);
  expect(resolveOwnerCredential(dir)).toBe(token);
  expect(readFileSync(file)).toEqual(before);
  expect(statSync(file).ino).toBe(inode);
  expect(statSync(file).nlink).toBe(1);
  expect(existsSync(stage)).toBe(false);
  expect(() => resolveOwnerCredential(dir, "a-different-token")).toThrow(/conflicts/);
  expect(resolveOwnerCredential(dir)).toBe(token);
});

it("still refuses unrelated hard links and does not follow staging symlinks", () => {
  const { dir, file, stage } = fixture(), before = readFileSync(file);
  const outside = join(dir, "unrelated-link");
  linkSync(file, outside);
  symlinkSync(outside, stage);
  expect(() => resolveOwnerCredential(dir)).toThrow(/unsafe/);
  expect(statSync(file).nlink).toBe(2);
  expect(readFileSync(file)).toEqual(before);
  expect(existsSync(stage)).toBe(true);
});
