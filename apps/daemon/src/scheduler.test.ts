import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createScheduler, type Job } from "./scheduler.js";

const T0 = new Date("2026-10-27T08:00:00Z");
const MIN = 60_000;
let now: Date;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  now = new Date(T0);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

const sched = (tickMs?: number) => createScheduler({ now: () => now, tickMs });
const counting = (id: string, everyMs = MIN) => {
  const calls: Date[] = [];
  const job: Job = {
    id,
    schedule: { everyMs: () => everyMs },
    run: async (at) => {
      calls.push(at);
    },
  };
  return { job, calls };
};

describe("interval jobs", () => {
  test("first fire is one interval after registration, not immediately", async () => {
    const s = sched();
    const { job, calls } = counting("a", 60 * MIN);
    s.register(job);
    await s.tick(new Date(T0.getTime() + 59 * MIN));
    expect(calls).toHaveLength(0);
    await s.tick(new Date(T0.getTime() + 60 * MIN));
    expect(calls).toHaveLength(1);
  });

  test("no catch-up: a long sleep runs the job once, then the next due is after now", async () => {
    const s = sched();
    const { job, calls } = counting("a", 10 * MIN);
    s.register(job);
    await s.tick(new Date(T0.getTime() + 100 * MIN));
    expect(calls).toHaveLength(1);
    await s.tick(new Date(T0.getTime() + 105 * MIN));
    expect(calls).toHaveLength(1);
    await s.tick(new Date(T0.getTime() + 110 * MIN));
    expect(calls).toHaveLength(2);
  });

  test("everyMs is re-read on every tick, so a changed interval applies without re-registering", async () => {
    let every = 60 * MIN;
    const calls: Date[] = [];
    const s = sched();
    s.register({ id: "a", schedule: { everyMs: () => every }, run: async (at) => void calls.push(at) });
    await s.tick(new Date(T0.getTime() + 5 * MIN));
    expect(calls).toHaveLength(0);
    every = 5 * MIN;
    await s.tick(new Date(T0.getTime() + 5 * MIN));
    expect(calls).toHaveLength(1);
  });

  test("an invalid interval is logged and does not stop other jobs", async () => {
    const s = sched();
    const bad = counting("bad");
    s.register({ ...bad.job, schedule: { everyMs: () => 0 } });
    const good = counting("good");
    s.register(good.job);
    await s.tick(new Date(T0.getTime() + MIN));
    expect(good.calls).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
  });

  test("duplicate ids are rejected", () => {
    const s = sched();
    s.register(counting("a").job);
    expect(() => s.register(counting("a").job)).toThrow(/already registered/);
  });
});

describe("cron jobs", () => {
  test("fires at the next cron time after registration, in the job's tz", async () => {
    const s = sched();
    const calls: Date[] = [];
    s.register({ id: "c", schedule: { cron: "0 9 * * *", tz: "UTC" }, run: async (at) => void calls.push(at) });
    await s.tick(new Date("2026-10-27T08:59:00Z"));
    expect(calls).toHaveLength(0);
    await s.tick(new Date("2026-10-27T09:00:00Z"));
    expect(calls).toHaveLength(1);
    await s.tick(new Date("2026-10-27T09:30:00Z"));
    expect(calls).toHaveLength(1);
    await s.tick(new Date("2026-10-28T09:00:00Z"));
    expect(calls).toHaveLength(2);
  });

  test("respects the tz (09:00 Auckland is 20:00 UTC the day before in late October)", async () => {
    const s = sched();
    const calls: Date[] = [];
    s.register({ id: "c", schedule: { cron: "0 9 * * *", tz: "Pacific/Auckland" }, run: async (at) => void calls.push(at) });
    // Registered at T0 (21:00 Auckland on Oct 27). The next 09:00 Auckland is Oct 28 09:00 NZDT = Oct 27 20:00Z.
    await s.tick(new Date("2026-10-27T20:00:00Z"));
    expect(calls).toHaveLength(1);
  });

  test("rejects 6-field (seconds) expressions and invalid expressions at register", () => {
    const s = sched();
    expect(() => s.register({ id: "x", schedule: { cron: "0 0 9 * * *", tz: "UTC" }, run: async () => {} })).toThrow(/5 fields/);
    expect(() => s.register({ id: "y", schedule: { cron: "99 * * * *", tz: "UTC" }, run: async () => {} })).toThrow(/invalid cron/);
    expect(() => s.register({ id: "z", schedule: { cron: "0 9 * * *", tz: "Not/AZone" }, run: async () => {} })).toThrow();
  });
});

describe("guards", () => {
  test("overlap: a job still running is skipped, and its schedule still advances", async () => {
    const s = sched();
    let release!: () => void;
    let runs = 0;
    s.register({
      id: "slow",
      schedule: { everyMs: () => MIN },
      run: () => {
        runs++;
        return new Promise<void>((resolve) => (release = resolve));
      },
    });
    const first = s.tick(new Date(T0.getTime() + MIN));
    await s.tick(new Date(T0.getTime() + 2 * MIN)); // previous run still pending
    expect(runs).toBe(1);
    release();
    await first;
    void s.tick(new Date(T0.getTime() + 3 * MIN)); // this run never settles; not awaited
    expect(runs).toBe(2);
  });

  test("shouldRun false skips the run but still advances the schedule", async () => {
    const s = sched();
    const allowed = { value: false };
    const calls: Date[] = [];
    s.register({
      id: "gated",
      schedule: { everyMs: () => MIN },
      shouldRun: () => allowed.value,
      run: async (at) => void calls.push(at),
    });
    await s.tick(new Date(T0.getTime() + MIN));
    expect(calls).toHaveLength(0);
    allowed.value = true;
    await s.tick(new Date(T0.getTime() + MIN + 30_000));
    expect(calls).toHaveLength(0); // schedule advanced to the next interval, not this tick
    await s.tick(new Date(T0.getTime() + 2 * MIN));
    expect(calls).toHaveLength(1);
  });

  test("a rejected run is logged with the message only, and other jobs still run", async () => {
    const s = sched();
    s.register({ id: "boom", schedule: { everyMs: () => MIN }, run: async () => { throw new Error("kaboom"); } });
    const other = counting("other");
    s.register(other.job);
    await expect(s.tick(new Date(T0.getTime() + MIN))).resolves.toBeUndefined();
    expect(other.calls).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith("scheduler job boom failed:", "kaboom");
  });

  test("a synchronous throw in run is also caught", async () => {
    const s = sched();
    s.register({ id: "sync", schedule: { everyMs: () => MIN }, run: () => { throw new Error("sync boom"); } });
    await expect(s.tick(new Date(T0.getTime() + MIN))).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("scheduler job sync failed:", "sync boom");
  });

  test("idle() resolves once in-flight runs settle", async () => {
    const s = sched();
    let release!: () => void;
    s.register({ id: "a", schedule: { everyMs: () => MIN }, run: () => new Promise<void>((r) => (release = r)) });
    void s.tick(new Date(T0.getTime() + MIN));
    let idle = false;
    const p = s.idle().then(() => (idle = true));
    await Promise.resolve();
    expect(idle).toBe(false);
    release();
    await p;
    expect(idle).toBe(true);
  });
});

describe("start / stop", () => {
  test("start and stop are idempotent (real timer, never fires within the test)", () => {
    const s = createScheduler({ tickMs: 3_600_000 });
    s.start();
    s.start();
    s.stop();
    s.stop();
  });
});
