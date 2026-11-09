// Composio bridge. Talks ONLY to https://backend.composio.dev (v3.1: GET /tools, POST /tools/execute/{slug}).
// The key comes from the daemon's environment (declared in the manifest) and is sent only in the x-api-key header.
// Results are returned as data; every error is a short fixed message (never a response body or the key).
const HOST = "https://backend.composio.dev/api/v3.1";
const key = process.env.COMPOSIO_API_KEY;
const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};
if (!key) fail("COMPOSIO_API_KEY is not set");

const mode = process.argv[2];
let input = "";
for await (const chunk of process.stdin) input += chunk;
const args = input ? JSON.parse(input) : {};

const SLUG = /^[A-Za-z0-9_]{1,100}$/;
const TOOLKIT = /^[a-z0-9_-]{1,60}$/;
const ACCOUNT = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_BYTES = 1024 * 1024;

async function call(path, init) {
  let res;
  try {
    res = await fetch(`${HOST}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
      headers: { "x-api-key": key, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
    });
  } catch {
    fail("request to Composio failed");
  }
  if (res.status === 401 || res.status === 403) fail("Composio rejected the API key");
  if (res.status === 429) fail("Composio rate limit");
  const reader = res.body ? res.body.getReader() : null;
  const chunks = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) fail("Composio response too large");
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  // Status first: an error page is often not JSON, and its body is never echoed.
  if (!res.ok) fail(`Composio error ${res.status}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    fail("unexpected response from Composio");
  }
  return json;
}

if (mode === "find") {
  const params = new URLSearchParams({ query: String(args.query ?? ""), limit: String(Math.max(1, Math.min(Number(args.limit) || 10, 25))) });
  if (args.toolkit) {
    if (!TOOLKIT.test(String(args.toolkit))) fail("invalid toolkit");
    params.set("toolkit_slug", String(args.toolkit));
  }
  const json = await call(`/tools?${params}`, { method: "GET" });
  const items = Array.isArray(json.items) ? json.items : [];
  console.log(
    JSON.stringify({
      tools: items.slice(0, 25).map((t) => ({ slug: t.slug, name: t.name, description: String(t.description ?? "").slice(0, 300), toolkit: t.toolkit?.slug })),
    }),
  );
} else if (mode === "run") {
  const slug = String(args.tool_slug ?? "");
  if (!SLUG.test(slug)) fail("invalid tool_slug");
  let toolArgs = {};
  if (args.arguments_json) {
    try {
      toolArgs = JSON.parse(String(args.arguments_json));
    } catch {
      fail("arguments_json is not valid JSON");
    }
    if (toolArgs === null || typeof toolArgs !== "object" || Array.isArray(toolArgs)) fail("arguments_json must be a JSON object");
  }
  const body = { arguments: toolArgs };
  if (args.connected_account_id) {
    if (!ACCOUNT.test(String(args.connected_account_id))) fail("invalid connected_account_id");
    body.connected_account_id = String(args.connected_account_id);
  }
  const json = await call(`/tools/execute/${encodeURIComponent(slug)}`, { method: "POST", body: JSON.stringify(body) });
  console.log(JSON.stringify({ successful: json.successful === true, data: json.data ?? null, error: json.error ?? null }));
} else {
  fail("unknown mode", 2);
}
