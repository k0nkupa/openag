---
name: build-integration
description: Create or update any OpenAg integration end to end without repeated fix rounds - an MCP server from mcp.json, an owner-installed App, a managed connection (Composio, Outlook, GitHub via a provider), or a first-party tool/channel. Use whenever the user adds, onboards, changes, fixes, tests, verifies or accepts a connector, App, MCP tool or provider, asks "does it work through both adapters", or says "test it" or "is it ready" about one. Front-loads the known failure classes before coding, then qualifies with bounded evidence and reports a coverage matrix instead of a blanket pass.
---

# Build or update an integration

The aim is one pass: design against the failures we already know, build on the shared path, qualify once with real evidence, and report exactly what was and was not proved. The managed-connection (Composio) work took many fix rounds because failures that were knowable up front were found one at a time, and narrow checks were reported as broad success. This skill moves that discovery to before the code is written and stops the loop when something is uncertain.

Read first: `docs/notes/mcp.md`, `docs/notes/mcp-lifecycle.md`, the integration's own note in `docs/notes/`, `GLOSSARY.md`, and the "Integration onboarding convention" and "Integration evidence and claims" sections of AGENTS.md/CLAUDE.md, which this skill implements.

## 1. Frame it

State, in a few lines kept in the ticket or the integration's `docs/notes/` file:

- **Kind:** MCP server from `$OPENAG_DATA/mcp.json` (`mcp.<server>.<tool>`), App (`app_<id>_<tool>`), managed connection, or first-party tool/channel. Each reaches the agent differently; do not copy the shape of another kind.
- **Change:** new, shared (MCP/adapter/policy), or integration-specific. Shared changes get the shared checks plus one representative live journey, not re-qualification of every integration. Integration-specific changes re-run only that integration.
- **Offered tools and expected class** for each (`read`, `search`, `act-local`, `act-external`, `secrets`). Unknown tools must classify `act-external` and ask. Class comes from owner/daemon declarations, never from server hints.
- **One safe read target** with an independent baseline obtainable outside OpenAg, and the **write boundary**: read-only, or a named disposable target the owner approved. Without one, writes stay unverified.
- **Out of scope.**

Why: this is what the evidence will be judged against. Writing it after the run lets the result define the test.

## 2. Pre-build review (the step that prevents fix rounds)

Open `references/known-failure-classes.md` and answer every row for this integration before writing code: either "handled by the shared path at <file>" or "needs work, here". Prefer the shared path (client factory, policy gate, receipts, tool registry); reimplementing any of it per integration is how drift and repeat bugs start. Then fill `references/path-checklist.md`: which check will exercise each layer, or GAP.

If a row reveals a defect in shared code, fix the shared contract for the whole class (all tool names, both adapters, fresh and reused sessions) in one change, not just the case you hit.

## 3. Build on the shared path

Smallest change that fits the existing structure. No new connector framework without a concrete need. Credentials stay env/encrypted-store only and go through the redactor. Add new top-level API routes to `API_SEGMENTS` in `static.ts`. Keep tool offering and diagnostics derived from the same definition (`docs/notes/capabilities.md`).

## 4. Update what the default bot knows

Per the CLAUDE.md knowledge rule: update `docs/help/` (manifest plus topic), the relevant `docs/notes/` file and any tool descriptions in the same change, run `node scripts/verify-bot-knowledge.mjs`, and record sources updated and how delivery was checked in the ticket Log. Label planned or unverified behavior as such.

## 5. Qualify

Use existing scripts; do not write a new bespoke one per integration.

1. **Shared checks (only if shared code changed):** `scripts/verify-acp-tool-identity.mjs`, `verify-action-receipts.mjs`, `verify-bot-knowledge.mjs`, `verify-capabilities.mjs`, `verify-connector-isolation.mjs`, and the MCP lifecycle/session scripts from `docs/notes/mcp-lifecycle-verification.md` and `mcp-session-verification.md`. Check whether the owner rule against unit-test suites (vitest/Jest) still applies before running `pnpm -r test`.
2. **One real journey through both Claude and Codex, session reused.** `scripts/verify-composio-readonly-e2e.mjs` is one worked example of the pattern, not a template to copy: disposable profiles, the integration's own credential, native tool bypasses disabled, fixed read target, explicit execute opt-in, independent baseline, private evidence directory, JSON report. Per adapter: discovery, schema, exact proposed call, OpenAg approval, provider prompt if any (a separate gate), result matched to the baseline and a provider-side log, then **a second call in the same session**. Adapt to the kind: an App has no provider prompt; a plain MCP server may have none.
3. Run adapters sequentially when an uncertain receipt could block the other. Watch the event that proves the outcome, not one that precedes it. Confirm the harness itself: it must fail when a nested or provider result fails, and a native tool must not be able to bypass the MCP route.

## 6. Loop discipline

If a check fails: name the stage and the class it belongs to, fix the class once, rerun the affected stage. If the **same stage fails twice**, or any outcome is unknown, a receipt is unresolved, or a provider prompt times out: **stop**. Do not retry, auto-recover or open a fresh investigation. Retrying a possibly-executed external action is the failure this prevents. Record the failed stage, invocation ids, approval state and sanitized provider response, and hand the decision to the owner.

## 7. Report

Fill `references/report-template.md` and put the matrix in the ticket `Log:`. Report controlled checks, live provider acceptance, deployment and owner-confirmed use separately; never merge them into "tested and working". A passing read says nothing about writes, other tools or other integrations. State exactly which checks were skipped and why. Don't read mail or content, send, or change provider state beyond the approved target, and park out-of-scope ideas under the Parking lot in ROADMAP.md.
