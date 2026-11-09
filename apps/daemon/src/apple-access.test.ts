import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppleAccess } from "./apple-access.js";

const dirs: string[] = [];
const dataDir = () => { const dir = mkdtempSync(join(tmpdir(), "oag-apple-")); chmodSync(dir, 0o700); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const permissionOf = (access: ReturnType<typeof createAppleAccess>, app: string) => access.status().apps.find(a => a.app === app)?.permission;

describe("apple access permission memory", () => {
  it("keeps a checked macOS permission across a daemon restart", async () => {
    const dir = dataDir();
    const first = createAppleAccess({ dataDir: dir, permission: async app => app === "contacts" ? "denied" : "granted" });
    await first.permission("mail"); await first.permission("contacts");
    const restarted = createAppleAccess({ dataDir: dir });
    expect(permissionOf(restarted, "mail")).toBe("granted");
    expect(permissionOf(restarted, "contacts")).toBe("denied");
    expect(permissionOf(restarted, "notes")).toBe("unknown");
  });

  it("stores the record with owner-only permissions", async () => {
    const dir = dataDir();
    await createAppleAccess({ dataDir: dir, permission: async () => "granted" }).permission("mail");
    expect(statSync(join(dir, "apple-permissions.json")).mode & 0o777).toBe(0o600);
  });

  it("ignores a corrupt or tampered record instead of failing startup", () => {
    const dir = dataDir();
    writeFileSync(join(dir, "apple-permissions.json"), JSON.stringify({ mail: "granted", constructor: "granted", notes: "yes", nope: "granted" }), { mode: 0o600 });
    const access = createAppleAccess({ dataDir: dir });
    expect(permissionOf(access, "mail")).toBe("granted");
    expect(permissionOf(access, "notes")).toBe("unknown");
    writeFileSync(join(dir, "apple-permissions.json"), "{not json");
    expect(permissionOf(createAppleAccess({ dataDir: dir }), "mail")).toBe("unknown");
  });
});
