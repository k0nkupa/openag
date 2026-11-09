---
status: accepted
---

# Let the owner add and edit MCP servers from the desk

MCP server configuration was operator-only (`mcp.json` edited on the host, never writable over HTTP) because a stdio server runs a command on the daemon host. The owner wants to manage servers from the desk, so the write path now exists, starting with remote HTTP servers and opening stdio only behind a hash-bound command review. Each change stays inside owner access, a checked and locked write to the same file, SSRF and environment-reference guards, and the existing approval gate: adding a server grants its tools no permission, and a server check is itself an approved tool action. Keeping the file operator-only would have been simpler and safer but left phones and the desk unable to manage the product's own integrations. It costs a larger attack surface that the guards, not the transport, now have to hold, and it revises the standing "never writable over HTTP" rule in CLAUDE.md and AGENTS.md. OA-454 to OA-457 implement this in stages; this decision does not by itself enable stdio, stored secrets or OAuth.

## OAuth sign-in (OA-457)

A custom remote server can sign in with OAuth. The daemon is the client: it validates discovery, registers (owner client, client metadata document, dynamic registration), sends the owner through the managed callback route and checks `state` and `iss` before it spends a code. MCP requests carry a bearer from one single-flight token manager instead of the SDK's `authProvider`: fresh stateless clients are created per call, and the SDK would run its own refresh and registration inside each, rotating one refresh token twice and replaying calls after a 401. Tokens live in their own encrypted store bound to server id, issuer and origin. Alternatives rejected: the SDK `authProvider` (above), a second callback path (it would need a relay redeploy this repo cannot verify), keeping attempts in the database (a restart simply means signing in again), and trusting provider metadata as given (the issuer, PKCE, endpoints and resource are checked). Real provider consent is manual and unverified by automated checks.

## Local commands (OA-456)

A command is written from the desk only behind a review: an `act-external` approval carries the resolved program, arguments, environment names, working directory and a sha256 of that spec and of the script files it names, and only the accepted payload is written, marked `managedBy: "desk"` with its `review`. The loader refuses to start a desk command whose hash, program or reviewed files differ, at load and before every spawn. Alternatives rejected: a second merged file (the single `mcp.json` with one writer, lock and digest already exists, and a marker plus id-collision refusal keeps operator entries untouched), trusting the command text alone (a script or PATH change would run unreviewed code), and allowing shells or inline code (the review could not describe what runs). Limits stated rather than hidden: files a reviewed script imports, and packages `npx` downloads, are not covered by the hash, and the child is not sandboxed.

## Direct secrets (OA-455)

Owner-typed secrets are stored in the connector credential store (`connector-mcp.enc`) under the existing connector key, referenced as `${secret:NAME}`, and bound to the server id and origin they were stored for. Alternatives rejected: one global namespace (a token could reach a second server by accident), binding to the full URL (a path edit would silently lose the secret), and keeping values in `mcp.json` or SQLite (backed up, readable by every file reader). Moving a server to another origin or removing it deletes its secrets; an unknown or wrongly bound reference fails closed rather than falling back.
