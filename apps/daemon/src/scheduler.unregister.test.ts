import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createScheduler, type Job } from "./scheduler.js";

const T0 = new Date("2026-10-27T08:00:00Z");
const MIN = 60_000;
let now: Date;

beforeEach(() => {
  now = new Date(T0);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const cronJob = (id: string, calls: Date[]): Job => ({
  id,
  schedule: { cron: "*/10 * * * *", tz: "UTC" },
  run: async (at) => {
    calls.push(at);
  },
});

describe("scheduler unregister", () => {
  test("unknown id returns false", () => {
    const s = createScheduler({ now: () => now });
    expect(s.unregister("nope")).toBe(false);
  });

  test("unregistered job never fires again", async () => {
    const s = createScheduler({ now: () => now });
    const calls: Date[] = [];
    s.register(cronJob("a", calls));
    expect(s.unregister("a")).toBe(true);
    await s.tick(new Date(T0.getTime() + 60 * MIN));
    expect(calls).toHaveLength(0);
  });

  test("the same id can be registered again after unregister, and fires on its new schedule", async () => {
    const s = createScheduler({ now: () => now });
    const first: Date[] = [];
    const second: Date[] = [];
    s.register(cronJob("a", first));
    s.unregister("a");
    s.register(cronJob("a", second));
    await s.tick(new Date("2026-10-27T08:10:00Z"));
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
  });

  test("an in-flight run finishes after unregister", async () => {
    const s = createScheduler({ now: () => now });
    let finished = false;
    const job: Job = {
      id: "slow",
      schedule: { everyMs: () => MIN },
      run: async () => {
        await new Promise((r) => setTimeout(r, 5));
        finished = true;
      },
    };
    s.register(job);
    const tick = s.tick(new Date(T0.getTime() + MIN));
    expect(s.unregister("slow")).toBe(true);
    await tick;
    expect(finished).toBe(true);
  });
});
