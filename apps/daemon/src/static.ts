import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";
import type { MiddlewareHandler } from "hono";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

// First path segments owned by the API. A file in the desk dir with one of these names must never shadow them.
const API_SEGMENTS = new Set(["turns", "dictation", "permissions", "avatars", "skills", "responsibilities", "composio-connect", "connectors", "app-library", "automation-runs", "questions", "work", "results", "rooms", "bots", "approvals", "health", "stream", "pair", "devices", "whoami", "settings", "wake", "digest", "brief", "automations", "hooks", "push", "mcp", "computer", "reflection", "apps", "router", "slack", "rtc", "backups", "ops", "readiness", "models", "memory"]);

function tryRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Raw request path, before any percent-decoding. */
function rawPath(url: string): string {
  const start = url.indexOf("/", url.indexOf("//") + 2);
  const path = start < 0 ? "/" : url.slice(start);
  return path.split(/[?#]/)[0] ?? "/";
}

/** Serves the built desk SPA from deskDir. Anything it does not serve falls through via next(). */
export function createStaticHandler(deskDir: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath(c.req.url));
    } catch {
      return c.text("bad request", 400);
    }
    if (decoded.includes("\0") || decoded.includes("\\")) return next();
    const segments = decoded.split("/").filter((s) => s !== "");
    if (segments.some((s) => s === ".." || s.startsWith("."))) return next(); // no traversal, no dotfiles

    const root = tryRealpath(deskDir);
    const isRoot = segments.length === 0 || ["/google-connect", "/composio-connect"].includes(decoded);
    if (isRoot) {
      if (!root || !isFile(join(root, "index.html"))) return c.text("Desk not built. Run: pnpm -r build", 503);
      const response = serve(c.req.method, join(root, "index.html"), "index.html");
      if (["/google-connect", "/composio-connect"].includes(decoded)) response.headers.set("referrer-policy", "no-referrer");
      return response;
    }
    if (!root || API_SEGMENTS.has(segments[0]!)) return next();

    const candidate = tryRealpath(join(root, ...segments));
    if (!candidate || !(candidate === root || candidate.startsWith(root + sep))) return next();
    if (!isFile(candidate)) return next();
    return serve(c.req.method, candidate, segments.join("/"));
  };
}

function serve(method: string, file: string, relPath: string): Response {
  const headers = new Headers({
    "content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "cache-control": relPath.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store",
  });
  const body = readFileSync(file);
  headers.set("content-length", String(body.byteLength));
  return new Response(method === "HEAD" ? null : body, { status: 200, headers });
}
