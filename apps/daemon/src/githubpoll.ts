/**
 * GitHub repository-event poller (OA-215). Outbound only: no public URL, no tunnel.
 *
 * Safety rules enforced here (the rest of the daemon never builds these requests):
 * - the host is FIXED (api.github.com) and the repo string is validated before it reaches a URL;
 * - redirects are refused (a redirect could carry the token to another host);
 * - the token goes only into the Authorization header and never into an error, result or log;
 * - errors carry a short fixed message, never the response body;
 * - the first poll only records a cursor, so history is never replayed as new events;
 * - results are reduced to a small set of clipped fields (the rest of the payload is dropped).
 */

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const TOKEN_MIN = 12;
export const TOKEN_MAX = 255;
export const MAX_ITEMS_PER_POLL = 10;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MIN_DELAY_SEC = 60;
const MAX_BACKOFF_SEC = 3600;

/** The allowlist names users pick, mapped to GitHub's event type names. */
export const POLL_EVENTS: Readonly<Record<string, string>> = Object.freeze({
  issues: "IssuesEvent",
  issue_comment: "IssueCommentEvent",
  pull_request: "PullRequestEvent",
  pull_request_review: "PullRequestReviewEvent",
  pull_request_review_comment: "PullRequestReviewCommentEvent",
  push: "PushEvent",
  release: "ReleaseEvent",
  create: "CreateEvent",
  delete: "DeleteEvent",
  fork: "ForkEvent",
  watch: "WatchEvent",
  discussion: "DiscussionEvent",
  commit_comment: "CommitCommentEvent",
});

export const isValidRepo = (repo: unknown): repo is string =>
  typeof repo === "string" && REPO_RE.test(repo) && !repo.split("/").some((p) => p === "." || p === "..");

// GitHub token formats (ghp_..., github_pat_..., gho_...) are letters, digits, "_" and "-". Anything else is refused, which
// also keeps out values the redactor ignores (paths, URLs) and anything that could break a header.
export const isValidToken = (token: unknown): token is string =>
  typeof token === "string" && token.length >= TOKEN_MIN && token.length <= TOKEN_MAX && /^[A-Za-z0-9_-]+$/.test(token);

export interface PollState {
  /** Quoted ETag of the last 200 response. */
  etag: string | null;
  /** Highest event id seen (decimal string). null until the first poll has recorded it. */
  cursor: string | null;
}

export interface PollItem {
  id: string;
  /** GitHub event type, e.g. IssuesEvent. */
  type: string;
  actor: string | null;
  repo: string | null;
  action: string | null;
  title: string | null;
  number: number | null;
  url: string | null;
  ref: string | null;
  /** Comment/review text or release name, clipped. */
  text: string | null;
  /** First lines of up to 3 commit messages (push events). */
  commits: string[];
  createdAt: string | null;
}

export type PollResult =
  | { kind: "ok"; state: PollState; items: PollItem[]; newCount: number; truncated: boolean; minDelaySec: number }
  | { kind: "not_modified"; state: PollState; minDelaySec: number }
  | { kind: "backoff"; delaySec: number; reason: string }
  | { kind: "error"; message: string };

export interface PollOptions {
  fetch: typeof fetch;
  token: string;
  repo: string;
  /** Allowlist names (keys of POLL_EVENTS). */
  allow: string[];
  state: PollState;
  maxItems?: number;
}

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  // Control characters plus invisible/bidi characters that could hide or reorder text for a reader.
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  return s ? (s.length > max ? `${s.slice(0, max)}…` : s) : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ID_RE = /^\d{1,20}$/;

/** Reduces one API event to the few fields a triage prompt needs. Pure. */
export function summarizeEvent(raw: unknown): PollItem | null {
  const e = obj(raw);
  if (typeof e.id !== "string" || !ID_RE.test(e.id) || typeof e.type !== "string") return null;
  const p = obj(e.payload);
  const issue = obj(p.issue);
  const pr = obj(p.pull_request);
  const subject = Object.keys(pr).length > 0 ? pr : issue;
  const comment = obj(p.comment);
  const review = obj(p.review);
  const release = obj(p.release);
  const commits = Array.isArray(p.commits) ? p.commits : [];
  return {
    id: e.id,
    type: clip(e.type, 60) ?? "unknown",
    actor: clip(obj(e.actor).login, 80),
    repo: clip(obj(e.repo).name, 200),
    action: clip(p.action, 40),
    title: clip(subject.title ?? release.name ?? release.tag_name, 300),
    number: num(subject.number) ?? num(p.number),
    url: clip(subject.html_url ?? comment.html_url ?? review.html_url ?? release.html_url, 300),
    ref: clip(p.ref, 200),
    text: clip(comment.body ?? review.body ?? release.body, 600),
    commits: commits
      .slice(0, 3)
      .map((c) => clip(String(obj(c).message ?? "").split("\n")[0], 200))
      .filter((m): m is string => m !== null),
    createdAt: clip(e.created_at, 40),
  };
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const header = (res: Response, name: string) => res.headers.get(name) ?? "";
const pollIntervalSec = (res: Response) => {
  const n = Number(header(res, "x-poll-interval"));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), MAX_BACKOFF_SEC) : DEFAULT_MIN_DELAY_SEC;
};

/** The wait GitHub asked for after a 403/429, in seconds (bounded), or null when the response is not a rate limit. */
function rateLimitDelay(res: Response, nowMs: number): number | null {
  const retry = Number(header(res, "retry-after"));
  if (Number.isFinite(retry) && retry > 0) return Math.min(Math.max(Math.ceil(retry), DEFAULT_MIN_DELAY_SEC), MAX_BACKOFF_SEC);
  if (header(res, "x-ratelimit-remaining") === "0") {
    const reset = Number(header(res, "x-ratelimit-reset"));
    const wait = Number.isFinite(reset) ? reset - Math.floor(nowMs / 1000) : DEFAULT_MIN_DELAY_SEC;
    return Math.min(Math.max(wait, DEFAULT_MIN_DELAY_SEC), MAX_BACKOFF_SEC);
  }
  return res.status === 429 ? DEFAULT_MIN_DELAY_SEC : null;
}

const bigId = (s: string) => BigInt(s);

/** One poll of `GET /repos/{owner}/{repo}/events`. Never throws. */
export async function pollRepoEvents(opts: PollOptions, now: () => number = Date.now): Promise<PollResult> {
  const { repo, token, state } = opts;
  if (!isValidRepo(repo)) return { kind: "error", message: "invalid repository" };
  if (!isValidToken(token)) return { kind: "error", message: "invalid token" };
  const wanted = new Set(opts.allow.map((name) => POLL_EVENTS[name]).filter((t): t is string => typeof t === "string"));
  const [owner, name] = repo.split("/") as [string, string];
  const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/events?per_page=100`;

  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "openagd",
  };
  if (state.etag) headers["if-none-match"] = state.etag;

  let res: Response;
  try {
    // redirect: "error" — never follow a redirect with the token attached.
    res = await opts.fetch(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return { kind: "error", message: "request failed" };
  }

  if (res.status === 304) return { kind: "not_modified", state, minDelaySec: pollIntervalSec(res) };
  if (res.status === 401) return { kind: "error", message: "token rejected" };
  if (res.status === 404) return { kind: "error", message: "repository not found or token has no access" };
  if (res.status === 403 || res.status === 429) {
    const delay = rateLimitDelay(res, now());
    return delay !== null ? { kind: "backoff", delaySec: delay, reason: "rate limited" } : { kind: "error", message: "forbidden" };
  }
  if (res.status >= 500) return { kind: "backoff", delaySec: 300, reason: `server error ${res.status}` };
  if (res.status !== 200) return { kind: "error", message: `unexpected status ${res.status}` };

  const text = await readCapped(res, MAX_RESPONSE_BYTES).catch(() => null);
  if (text === null) return { kind: "error", message: "response too large" };
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return { kind: "error", message: "unexpected response" };
  }
  if (!Array.isArray(list)) return { kind: "error", message: "unexpected response" };

  const events = list.map(summarizeEvent).filter((e): e is PollItem => e !== null);
  const etag = res.headers.get("etag");
  let top = state.cursor;
  for (const e of events) if (top === null || bigId(e.id) > bigId(top)) top = e.id;
  // An empty first poll still records a cursor ("0"), so events created afterwards are not mistaken for history.
  const next: PollState = { etag: etag && etag.length <= 200 ? etag : null, cursor: top ?? "0" };

  // The very first poll only records where "now" is: history is never replayed as new events.
  if (state.cursor === null) return { kind: "ok", state: next, items: [], newCount: 0, truncated: false, minDelaySec: pollIntervalSec(res) };

  const cursor = bigId(state.cursor);
  const fresh = events
    .filter((e) => bigId(e.id) > cursor && wanted.has(e.type))
    .sort((a, b) => (bigId(a.id) < bigId(b.id) ? -1 : bigId(a.id) > bigId(b.id) ? 1 : 0));
  const max = opts.maxItems ?? MAX_ITEMS_PER_POLL;
  const truncated = fresh.length > max;
  const items = truncated ? fresh.slice(fresh.length - max) : fresh; // keep the newest
  return { kind: "ok", state: next, items, newCount: fresh.length, truncated, minDelaySec: pollIntervalSec(res) };
}

const clipTo = (v: string | null, n: number) => (v === null ? null : v.length > n ? `${v.slice(0, n)}…` : v);

/**
 * Fits the items into a JSON budget BEFORE they are serialised into a prompt (a blind clip of the JSON would cut the
 * newest items, which are last, and the cursor has already moved past them). Shrinks free text first, then drops the
 * OLDEST items whole. `omitted` counts the dropped ones so the prompt can say so.
 */
export function fitItems(items: PollItem[], budget: number): { items: PollItem[]; omitted: number } {
  let list = items.map((i) => ({ ...i, commits: [...i.commits] }));
  const size = () => JSON.stringify(list).length;
  const steps: Array<(i: PollItem) => void> = [
    (i) => void (i.text = clipTo(i.text, 200)),
    (i) => void ((i.text = clipTo(i.text, 80)), (i.commits = i.commits.map((c) => clipTo(c, 80)).filter((c): c is string => c !== null))),
    (i) => void ((i.text = null), (i.title = clipTo(i.title, 120)), (i.commits = i.commits.slice(0, 1))),
    (i) => void ((i.title = clipTo(i.title, 60)), (i.commits = []), (i.url = null)),
  ];
  for (const step of steps) {
    if (size() <= budget) break;
    for (const i of list) step(i);
  }
  let omitted = 0;
  while (list.length > 1 && size() > budget) {
    list = list.slice(1);
    omitted++;
  }
  return { items: list, omitted };
}
