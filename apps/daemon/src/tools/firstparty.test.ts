import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { openDb } from "../db/index.js";
import type { Computer } from "../computer.js";
import { MCP_TOOL_NAMES } from "../mcpserver.js";
import type { Pusher } from "../push.js";
import { defaultTools } from "../runtimes/tools.js";
import { createGoogleConnectors } from "../google-connectors.js";
import { createFirstPartyTools } from "./firstparty.js";

describe("first-party tool wiring", () => {
  // skill_list is only wired when a DB (or catalogue) is supplied, as the daemon does.
  const dir = mkdtempSync(join(tmpdir(), "openag-firstparty-"));
  const db = openDb(dir);
  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const { defs, executors } = createFirstPartyTools({ db, google: createGoogleConnectors({ dataDir: "/unused", env: {} }), computer: {} as Computer, pusher: { status: () => ({ configured: false, enabled: false }) } as unknown as Pusher });

  test("every tool the MCP server can expose has an executor the runner can resolve (no pass-the-gate-then-unknown-tool)", () => {
    for (const name of MCP_TOOL_NAMES) {
      expect(defs.some((d) => d.name === name), `${name} has a def`).toBe(true);
      const known = Object.hasOwn(executors, name) || Object.hasOwn(defaultTools, name);
      expect(known, `${name} has an executor`).toBe(true);
    }
  });
});
