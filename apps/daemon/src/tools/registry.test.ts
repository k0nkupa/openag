import { describe, expect, test } from "vitest";
import { z } from "zod";
import { classify } from "../policy.js";
import { createBraveTool } from "./brave.js";
import { writeFileTool } from "./files.js";
import { defaultToolDefs } from "./index.js";
import { enabledTools, type ToolDef, toExecutors } from "./registry.js";

const ctx = { botId: "boss", dataDir: "/nonexistent" };

function fakeDef(name: string, enabled?: () => boolean): ToolDef<{ n: number }> {
  return {
    name,
    class: "read",
    description: "d",
    input: z.object({ n: z.number() }),
    enabled,
    execute: async (_c, args) => ({ doubled: args.n * 2 }),
  };
}

describe("enabledTools", () => {
  test("keeps tools with no enabled() or enabled() true, drops the rest", () => {
    const a = fakeDef("a");
    const b = fakeDef("b", () => true);
    const c = fakeDef("c", () => false);
    expect(enabledTools([a, b, c]).map((d) => d.name)).toEqual(["a", "b"]);
  });
});

describe("toExecutors", () => {
  test("runs execute with validated args", async () => {
    const exec = toExecutors([fakeDef("dbl")]).dbl!;
    await expect(exec(ctx, { n: 4 })).resolves.toEqual({ doubled: 8 });
  });

  test("invalid args throw a clear error and do not execute", async () => {
    let ran = false;
    const def: ToolDef = { ...fakeDef("v"), execute: async () => ((ran = true), {}) };
    const exec = toExecutors([def]).v!;
    await expect(exec(ctx, { n: "nope" })).rejects.toThrow(/invalid arguments for v: n:/);
    await expect(exec(ctx, undefined)).rejects.toThrow(/invalid arguments for v/);
    expect(ran).toBe(false);
  });

  test("a disabled tool throws 'not enabled' before validating or running", async () => {
    let ran = false;
    const def: ToolDef = { ...fakeDef("off", () => false), execute: async () => ((ran = true), {}) };
    const exec = toExecutors([def]).off!;
    await expect(exec(ctx, { n: 1 })).rejects.toThrow("tool off is not enabled");
    expect(ran).toBe(false);
  });
});

describe("registry consistency", () => {
  test("every default tool def's class matches the policy classifier", () => {
    for (const def of defaultToolDefs) {
      expect(def.class, def.name).toBe(classify(def.name));
    }
  });

  test("write_file is act-local and brave_search is search", () => {
    expect(writeFileTool.class).toBe("act-local");
    expect(createBraveTool({ apiKey: () => undefined }).class).toBe("search");
  });

  test("provider-native tool names stay classified", () => {
    expect(classify("WebSearch")).toBe("search");
    expect(classify("WebFetch")).toBe("browse");
    expect(classify("codex.search")).toBe("search");
    expect(classify("codex.fetch")).toBe("browse");
  });
});
