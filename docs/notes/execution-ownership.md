# Execution ownership repair

Owner approved the three-slice plan: OA-454 App cancellation, OA-455 pending MCP connections, OA-456 daemon shutdown. Implementation acceptance is source and controlled/local evidence. Local main merge and redeployment were authorized on 5 November 2026; deployment evidence is recorded in the dated local release note. No external business operations. Original implementation commits and evidence directories retain their pre-reconciliation OA-451–453 identities.

## OA-454 App cancellation

The App executor passes the turn signal through to the child-process owner. An already cancelled operation fails before spawn. Cancellation after spawn kills the owned process group, removes its listener/timer and waits for child exit before returning failure. Completion and cancellation settle once. Existing receipt classification, Unknown preservation and no-replay rules remain.

Before the fix, both installed real adapters completed a first App call then reused the same session for a held call. A mode downgrade during that second call took approximately six seconds to finish and allowed the next App write. After the fix, Claude sonnet stopped in 67 ms and Codex gpt-6.1-sol in 60 ms; neither performed the next write. Both retained Unknown receipts. These were disposable local App effects, not provider business writes. The real-adapter checkpoint ran before broadening controlled coverage.

`node scripts/verify-execution-ownership.mjs --real-acp`: passed after the fix. `node scripts/verify-tool-execution-reliability.mjs`: 16 gateway/API/Ollama cases passed, including actual App child termination during mode downgrade and Work cancellation, independent target readback, Unknown fences and no replay. The App's first marker remains, its second marker is absent and its PID is gone before settlement. Model transports in the hosted matrix are controlled; App processes and the daemon gate are real.

Sanitized before/after real-adapter evidence was recorded during the release. No production bot, permission mode or model was changed. Other acceptance and review results are recorded as each slice completes.

## Knowledge and limits

Canonical App documentation and Work help explain cancellation/termination without claiming rollback or downstream confirmation. Build packaging and the existing knowledge verifier must pass before the slice is marked complete. Shared knowledge contains no credentials or private test targets. Native ACP effects remain disabled; both real-adapter runs used exact daemon tools.

Implementation verification used no unit/Jest/Vitest, automatic retries, receipt/schema changes, capability relaxation or generic lifecycle framework. The later authorized local merge/deployment is recorded separately. Escaped/unowned descendants and already accepted remote effects are not claimed to be reversed or controllable.

## OA-455 MCP initialization

Pending connectors receive an abort signal. Timed-out attempts retain ownership of late handles, which close once and cannot enter the current catalogue. Stdio close waits for exit and retains its existing two-second TERM-to-KILL grace. Reload cancels pending acquisition; manager close also waits for abandoned cleanup. No tool is retried.

`node scripts/verify-mcp-ownership.mjs` passed nine local SDK transport/process cases: close during stdio initialization, fifteen-second timeout, deliberately non-cancellable late acquisition, reload both during initialization and after connection, HTTP initialization cancellation, rejected closure of connected/late handles, and concurrent closure of two owned processes. The rejected-close cases use an injected connector handle around the real transport to verify failure reporting. Resistant child PIDs were gone before closure settled; the late handle closed once. These checks use no provider account or model.

## OA-456 Daemon drain

Runner admission closes synchronously at shutdown. All admitted runs are tracked through a separate `drain()` barrier, including direct/chat, queued and resumed execution and turn background jobs. `idle()` retains its existing narrower behavior. The entrypoint shares one shutdown promise, stops schedulers/admission, revokes access, cancels execution and waits for the runner and existing owners together before closing SQLite. The overall ceiling is twenty seconds. Hosted release retains its five-second limit; failed cleanup or the overall deadline reports an incomplete stop and exits nonzero.

`node scripts/verify-daemon-shutdown.mjs` runs the actual built daemon entrypoint against temporary data and a controlled local Ollama transport. A real TERM-resistant command stopped before daemon exit (~1 second); its second write was absent and its retained turn/receipt stayed Interrupted/Unknown. A second admitted chat did not execute during drain. A pending review survived shutdown and restart with the same ID, no model continuation and no command dispatch. Repeated SIGTERM/SIGINT used the same stop. A controlled Browserbase HTTP shim also returns a release failure: the router propagates it, and the daemon exits 1 without logging a successful drain. A deliberately uncooperative metadata-fetch shim exercised the actual entrypoint deadline: forced exit 1 after ~20 seconds, with the child stopped, the next write absent and Interrupted/Unknown records retained. The shim changes only the transport; it does not copy shutdown logic or add production settings. This is local process/storage acceptance, not remote cancellation or hosted-provider release acceptance.

Workspace build passed (relay packaging was dry-run only). Standalone Work, input-runtime, tool lifecycle, receipt/recovery, hosted-outcome, execution-world, fourteen controlled provider and delivered-knowledge checks passed. The Work fixture now uses the production drain barrier before database closure. The first built-in cumulative review found swallowed hosted-release failures. The router now propagates rejected and unconfirmed stop states; the actual daemon rejected-release scenario passes. A follow-up review found swallowed abandoned-MCP close failures. The manager now tracks pending handle cleanup and retains failures for its shutdown verdict; the added connected/late rejected-close probes verify reporting. Final built-in cumulative review against `7358d82` found no remaining actionable correctness defects after those fixes. Review was read-only; runtime acceptance comes from the separate standalone checks.

Sanitized final local evidence is recorded during the release: daemon shutdown, nine MCP ownership cases and the sixteen-case API/Ollama lifecycle matrix.
