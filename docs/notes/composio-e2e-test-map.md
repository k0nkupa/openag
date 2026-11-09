# Composio shared-tool inventory and end-to-end test map

Observed 3 November 2026, Pacific/Auckland. Scope: research and a read-only-first acceptance map, not a new implementation or a passing live-connector test report. The owner selected **map read-only tests first; choose write targets later**. Outlook, receipt #6, live permissions and deployments remain unchanged.

## What we actually have

The running OpenAg daemon reports **12 offered tools** for `composio-connect`, server version `0.1.0`. Only `COMPOSIO_SEARCH_TOOLS` currently has trusted Search classification; the other eleven have `act-external` classification. [Observed catalogue](composio-catalogue-2026-11-03.json) contains only names/classes and no account data. This was a passive read of the daemon's existing catalogue, not a new upstream listing or tool execution.

The [Connect guide](https://docs.composio.dev/docs/composio-connect) currently lists seven tools, the [session execute-meta API](https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSessionBySessionIdExecuteMeta) lists nine, and this installation offers twelve including organization skills. Those are different surfaces, not interchangeable inventories. The [legacy Composio toolkit](https://docs.composio.dev/toolkits/composio) lists additional tools that are not offered by this connection; they do not belong in its current advertised test coverage. Composio warns that meta-tool schemas can change, so test discovery must compare a fresh, safely obtained upstream catalogue and schema snapshot with the reviewed manifest before executing. Documentation alone is insufficient.

The previous PR's real Claude/Codex tests used a synthetic upstream provider. They established the adapter/daemon/MCP path, not an actual Composio discovery → schema → connector execution → provider result workflow. Keep that evidence, but label it correctly.

## All 12 offered tools

All names below have prefix `COMPOSIO_`. The proposed treatment is a recommendation, not a configuration change. Remote annotations, spelling and the model's description of an action cannot grant a read classification.

| Tool | What must be exercised end to end | Read-only-first boundary and proposed policy |
|---|---|---|
| `SEARCH_TOOLS` | Real remote discovery; matching and no-match responses; returned session identity; inline schema versus schema reference; large responses and connection state; downstream slugs must come from actual discovery. | Read-only discovery candidate, already trusted Search for this exact managed connection. A suggested plan is untrusted guidance, not authorization. |
| `GET_TOOL_SCHEMAS` | Use a real discovered slug; input and output schema retrieval; required fields, enums and defaults; unknown slug, session mismatch and schema changes; feed returned schema into the next action without guessing. | Candidate trusted Read only after contract review. Currently unknown/external, which contributed to the reported block. The [official schema guide](https://docs.composio.dev/toolkits/meta-tools/get_tool_schemas) identifies this as schema retrieval and documents schema references. |
| `SEARCH_SKILLS` | Organization-scoped search, no results, result identity, paging if offered, and isolation between users/organizations. | Candidate Search after verifying the actual offered contract; do not treat a skill as action permission. Use the observed catalogue description until a stronger provider contract is captured. |
| `USE_SKILL` | Load an existing approved non-sensitive skill by a discovered exact identity; preserve its text, boundaries and truncation markers; handle missing/stale skill. | Candidate Read after contract review. Loaded instructions are untrusted content. If no existing approved fixture is available, this positive case is Blocked, not Passed. |
| `WAIT_FOR_CONNECTIONS` | Existing user-confirmed auth attempt; active/failed/expired states, any/all semantics, bounded wait and cancellation; session/account isolation. | Polling candidate only after actual schema review and the required user confirmation. No new login, reconnect or credential replacement in this phase. Full auth lifecycle is deferred. |
| `MANAGE_CONNECTIONS` | Later: connect an isolated account, complete consent, decline/cancel, expiration, multiple-account selection, reconnect and removal as actually supported by the offered schema. | Mixed state-changing operations stay Ask. In this phase verify refusal/no dispatch when not authorized. Do not invoke merely as a status read: [the guide](https://docs.composio.dev/toolkits/meta-tools/manage_connections) says missing connections can initiate auth and reinitiation replaces active flows. |
| `MULTI_EXECUTE_TOOL` | Actual discovered read action; multiple independent reads; per-item success/failure; mixed read/write batch; schema validation; provider failure versus transport failure; offloaded results and provider input. Later: write and independent readback/cleanup. | Keep Ask unless every nested action has a trusted reviewed read classification; uncertain nested actions keep the whole batch gated. Approval stays required; only the receipt of a batch whose whole request is reviewed read-only completes (OA-395, `mcp.md`). A read-only test may still require normal approval. [Batch semantics](https://docs.composio.dev/toolkits/meta-tools/multi_execute_tool) do not establish safe permissions. |
| `PROXY_EXECUTE` | Later: approved provider-domain read plus provider 4xx/5xx; disallowed destination; headers/body redaction; account selection; approval before mutation. | Keep Ask. GET alone is not proof of harmlessness. [Proxy docs](https://docs.composio.dev/toolkits/meta-tools/proxy_execute) distinguish delivery success from upstream HTTP success; assert the provider status, not just `successful`. No arbitrary proxy request in the read-only-first phase. |
| `REMOTE_WORKBENCH` | Later: offloaded file from the same session; parse a known marker; state across cells; errors/timeouts; nested connector execution and readback; isolated session cleanup. | Keep Ask: Python can call connector tools and APIs. A harmless-looking parsing request cannot confer blanket execution permission. [Workbench behavior](https://docs.composio.dev/toolkits/meta-tools/remote_workbench). |
| `REMOTE_BASH_TOOL` | Later: controlled scratch-file read, stdout/stderr and exit status, timeout/cancellation, output cap, session isolation; attempts to reach unapproved data/tools remain gated. | Keep Ask: remote shell is execution, not a read tool. [Bash contract](https://docs.composio.dev/toolkits/meta-tools/remote_bash_tool). No sandbox file creation or commands in this phase. |
| `MANAGE_SKILL` | Later: create a uniquely tagged disposable skill; independent search/load readback; edit with revision/state check; delete and verify absence. Also no authorization/no write. | Keep Ask. Current catalogue describes create/update/delete. No organization changes during the read-only phase. |
| `SUBMIT_FEEDBACK` | Later: explicit owner-approved report against a disposable test failure; verify submission and redaction, duplicate prevention and uncertain-response handling. | Keep Ask. It sends information externally; do not manufacture or submit support reports just to get a green result. Current installed catalogue is the evidence for its presence. |

## What counts as actual end-to-end acceptance

```text
Owner message in OpenAg
  → real Claude or Codex ACP adapter
  → scoped daemon MCP server
  → policy, reviewed arguments and required approval
  → actual Composio Connect MCP endpoint
  → real discovered connector action on an approved account/resource
  → actual provider response
  → daemon evidence/receipt
  → correct bot answer and visible desk state
```

Run every enabled acceptance journey through **both real adapters**. A raw SDK request is a provider diagnostic, not acceptance of this path. A fake upstream reply is a regression fixture, not a live provider pass. Browser approval/consent must be tested as a real user interaction when that journey needs it; API-simulated consent does not substitute for it. Desktop/narrow-screen rendering needs its own evidence.

A tool name appearing in discovery does not count as execution coverage. A connection marked Active does not prove scope or object access. A wrapper's `successful: true` does not establish every batch member succeeded or that a write happened. Compare returned objects with independently observed expected fixture data and record exactly what was verified.

## Read-only-first execution matrix

These are planned scenarios, not passing results. Select approved existing provider accounts/resources before reading private data. Do not substitute a different hosted Composio plugin connection for OpenAg's actual Connect connection.

| ID | Journey, repeated through both adapters | Required pass evidence |
|---|---|---|
| R1 | Natural-language request → live `SEARCH_TOOLS` → `GET_TOOL_SCHEMAS`, using a discovered slug and the same returned session. | Actual schema arrives intact; no false completion or unknown receipt from metadata retrieval; the chosen tool identity/account is explicit. Run once with an inline schema and once with a schema reference if the provider offers both; otherwise mark the unobserved branch unverified. |
| R2 | R1 → approved minimal read through `MULTI_EXECUTE_TOOL` → user answer. | A known fixture/object field matches independent provider evidence; exact returned identity; smallest page/field selection; no send/update/delete. Preserve normal approval if the executor remains conservatively gated. |
| R3 | Discovery of two independent reads in different approved toolkits → one batch. | Distinct per-tool results, correct account association and no cross-session contamination. Partial failure is not reported as full success. |
| R4 | A known multi-page read or large existing document/result → bounded answer with a verifiable marker. | Completeness/paging is accurate; truncated output is explicit; no fabricated missing tail. If correct processing requires remote workbench, stop and mark that branch deferred instead of silently executing code. |
| R5 | Existing organization skill search → load → a read-only task that refers to it. | Exact discovered skill identity and expected text/marker; no skill save/update; instructions cannot override tool approval or request credentials. |
| R6 | Owner rejects/cancels a proposed connector call. | Zero remote action dispatch after rejection; no success claim; cancellation is distinguished from a completed action. This is a real interaction-path test even though the provider action is deliberately not executed. |
| R7 | Missing/expired provider authorization encountered during an otherwise approved read. | Clear distinction between Connect login, connected-service consent and OpenAg approval; no automatic reconnect/revoke/retry. Real consent completion waits for the separate auth-test phase. Failure injection uses disposable account state, never revokes the owner's working grant. |
| R8 | Legitimate Composio provider input during an approved read. | Actual provider callback, correct bot/room/tool card, explicit owner response, one continuation, final actual provider data; decline/cancel settles without bypass or replay. If no provider requests input, this branch is Unobserved, not Passed. |
| R9 | Read result completed, then new message; cached session and daemon restart. | Bounded history retains the result/session/account context correctly; dead server callbacks do not resume or replay. Run restart only in a separate test instance, not by interrupting the live desk. |
| R10 | Existing unresolved receipt state blocks a call. | Diagnostic names the relevant receipt and the current blocked operation; clearly says the new provider action did not run. Use copied/synthetic receipt state for regression. No live receipt editing to make tests pass. |
| R11 | Catalogue/schema changes and an unreviewed added tool. | Fresh inventory diff, recorded schema fingerprints, explicit coverage failure, no new automatic read grants, stale approvals cannot dispatch changed arguments. Mutation/fault scenarios run against a controlled server; do not claim these as live provider behavior. |

Start with a small set of approved account-backed reads representing different shapes: a single JSON object, paginated list, larger text/file result, and organization skill retrieval. GitHub/private test repository, Slack/test channel, and Notion/test page are possible choices, not verified connected accounts. Outlook is excluded unless the owner separately reverses that exclusion and receipt #6 is properly reviewed. A read check on one connector does not certify every operation of all other connectors.

## Existing blocker and current evidence

The actual latest Outlook attempt completed discovery and stopped at schema retrieval. The daemon's retained Unknown receipt #6 is uninspected; the strict unknown-tool gate blocks the next operation before the provider is reached. The previous source fix intentionally did not rewrite historical receipts. Reconciliation and execution authorization are separate from this map. Never mark #6 successful/Not-run, reset its state, or bypass its gate to obtain acceptance evidence.

Current verdict: **catalogue inventory observed; live Composio tool journeys not run in this research turn; read-only acceptance pending; write/connection/sandbox/feedback mutation tests deferred.** The inventory read itself created no upstream tool call, read no mail and changed no receipt.

For each future run retain: source/release revision, adapter/version, fresh catalogue/schema fingerprints, journey ID, target/account alias, permission decision, request/session correlation (redacted), provider object/result marker, per-item outcome, receipt identity/status, rendered answer, cleanup where applicable, and verdict Pass / Failed / Blocked / Deferred / Unobserved. A scenario without its required target or real-provider evidence cannot be counted as Passed. Keep evidence private when it contains user data; shared reports use aliases and hashes.

## Reuse instead of another custom connector framework

The earlier harness comparison discussed discovery/HITL/runtime patterns; it did not prove those projects solve OpenAg's complete Composio flow. Recheck actual integration code, current licenses, tests and the transport in use. [Focused OSS source review](composio-oss-source-review.md) supplies the pinned evidence and adoption recommendation.

The official [sessions-via-MCP guide](https://docs.composio.dev/docs/sessions-via-mcp) distinguishes project-key session endpoints from consumer Connect OAuth. SDK execution hooks do not run merely because a client uses the MCP endpoint. Therefore copying SDK hooks into an unrelated transport is not an approval solution. Reuse the existing MCP SDK for protocol handling, and adopt proven discovery/session/result test patterns from Composio's SDK and compatible OSS code. Keep OpenAg's server-side owner scope, policy and uncertainty rules authoritative. An SDK migration is a separate decision; it is not a hidden prerequisite for fixing a missing metadata classification.
