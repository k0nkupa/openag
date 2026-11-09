import { CronExpressionParser } from "cron-parser";

export interface ScheduledTick { dueAt: number; nextAt: number; }

export interface Job {
  id: string;
  schedule: { everyMs: () => number } | { cron: string; tz: string } | {at:()=>number};
  /** False skips this run; the schedule still advances. */
  shouldRun?: (now: Date) => boolean;
  run: (now: Date, occurrence: ScheduledTick) => Promise<void>;
  /** Optional observation of an overlap skip; never queues another execution. */
  onSkip?: (now: Date, occurrence: ScheduledTick) => void;
}

export interface Scheduler {
  nextRunAt(id:string):number|null;
  register(job: Job): void;
  /** Removes the job. An in-flight run finishes normally; unknown id returns false. */
  unregister(id: string): boolean;
  start(): void;
  stop(): void;
  tick(now?: Date): Promise<void>;
  /** Resolves when every run in flight has settled. */
  idle(): Promise<void>;
}

interface Entry {
  job: Job;
  /** Interval jobs: time of the last fire (or registration). everyMs() is re-read every tick so changes apply at once. */
  anchor: number;
  /** Cron jobs: next cron time, recomputed after each fire. */
  nextDue: number;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Exactly five fields. cron-parser would also accept six (seconds), which we refuse. */
function nextCronTime(cron: string, tz: string, from: Date): number {
  if (cron.trim().split(/\s+/).length !== 5) throw new Error(`cron must have exactly 5 fields: "${cron}"`);
  try {
    return CronExpressionParser.parse(cron, { currentDate: from, tz }).next().toDate().getTime();
  } catch (err) {
    throw new Error(`invalid cron expression "${cron}": ${errorText(err)}`);
  }
}

export function createScheduler(opts: { now?: () => Date; tickMs?: number } = {}): Scheduler {
  const clock = opts.now ?? (() => new Date());
  const tickMs = opts.tickMs ?? 30_000;
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<void>>();
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runJob(job: Job, now: Date, occurrence: ScheduledTick): Promise<void> {
    try {
      await job.run(now, occurrence);
    } catch (err) {
      console.error(`scheduler job ${job.id} failed:`, errorText(err));
    }
  }

  async function tick(at?: Date): Promise<void> {
    const now = at ?? clock();
    const t = now.getTime();
    const starts: Promise<void>[] = [];
    for (const [id, entry] of entries) {
      const { job } = entry;
      const schedule = job.schedule;
      const isCron = "cron" in schedule;
      let due: number;
      try {
        if ("cron" in schedule) {
          due = entry.nextDue;
        } else if('at' in schedule){
          due=schedule.at();
        } else {
          const ms = schedule.everyMs();
          if (!Number.isFinite(ms) || ms <= 0) throw new Error("everyMs must be a positive number");
          due = entry.anchor + ms;
        }
      } catch (err) {
        console.error(`scheduler job ${id} failed:`, errorText(err));
        continue;
      }
      if (due > t) continue;

      // Advance before running: missed periods are never replayed, and a skipped run still advances.
      if (isCron && "cron" in schedule) {
        try {
          entry.nextDue = nextCronTime(schedule.cron, schedule.tz, now);
        } catch (err) {
          console.error(`scheduler job ${id} failed:`, errorText(err));
          continue;
        }
      } else if(!('at' in schedule)) {
        entry.anchor = t;
      }

      const occurrence = {dueAt: due, nextAt: isCron ? entry.nextDue : t};
      if (inFlight.has(id)) {
        try { job.onSkip?.(now, occurrence); }
        catch (err) { console.error(`scheduler job ${id} skip observation failed:`, errorText(err)); }
        continue;
      } // overlap guard: the previous run has not finished

      let should = true;
      try {
        should = job.shouldRun ? job.shouldRun(now) : true;
      } catch (err) {
        console.error(`scheduler job ${id} failed:`, errorText(err));
        should = false;
      }
      if (!should) continue;

      const p = runJob(job, now, occurrence).finally(() => inFlight.delete(id));
      inFlight.set(id, p);
      starts.push(p);
    }
    await Promise.all(starts);
  }

  return {
    nextRunAt(id){
      const entry=entries.get(id);if(!entry)return null;
      try{const schedule=entry.job.schedule;const at='cron' in schedule?entry.nextDue:'at' in schedule?schedule.at():entry.anchor+schedule.everyMs();return Number.isFinite(at)?at:null;}catch{return null;}
    },
    register(job) {
      if (entries.has(job.id)) throw new Error(`scheduler job ${job.id} is already registered`);
      const now = clock();
      const nextDue =
        "cron" in job.schedule ? nextCronTime(job.schedule.cron, job.schedule.tz, now) : 0; // cron validated eagerly
      entries.set(job.id, { job, anchor: now.getTime(), nextDue });
    },

    unregister(id) {
      return entries.delete(id);
    },

    tick,

    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), tickMs);
      timer.unref();
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },

    async idle() {
      while (inFlight.size > 0) await Promise.all([...inFlight.values()]);
    },
  };
}
