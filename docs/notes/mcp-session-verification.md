# MCP stateless session and Outlook acceptance (OA-391)

3 November 2026, Pacific/Auckland. Source-only change on `codex/composio-readonly-acceptance`; no deployment. Owner approved the domain model, generic implementation and bounded Outlook reads through both real adapters, including reused sessions.

## Evidence and fix

A metadata-only handshake probe of the existing consumer connection advertised form/URL elicitation correctly. The endpoint returned no MCP session ID and answered the optional GET event stream with 405. The earlier live source reused its catalogue client's handshake for later calls; it had produced an unanswered prompt and then an unsupported-elicitation rejection. We cannot inspect the provider's internal cache or establish its exact eviction mechanism from those records.

A real HTTP/SDK regression simulated eviction of stateless handshake capability state after a successful prompt. `node scripts/verify-mcp-session-lifecycle.mjs` failed with **Reused stateless connection lost elicitation capability** before the fix. It passes after the shared stateless invocation path gets a fresh initialized client and callback context for each separately authorized call. No provider/tool name is used in runtime session handling. Both configured HTTP and managed connections use it. Stateful HTTP and stdio retain their existing path.

Fresh clients load a bounded complete catalogue and compare the selected tool to the reviewed contract. The selected page is loaded last because the SDK replaces its per-client output/task metadata cache per catalogue page. Schema/task checks remain active. Failed negotiation or invalid/changed catalogue returns Not-run before tools/call. Failures after dispatch retain uncertainty. Queued calls stay serialized; invocation clients close on completion/cancellation. Provider workflow arguments are unchanged; no call is automatically replayed.

## Actual Outlook acceptance

The initial attempt stopped before a provider tool dispatch because the copied access token had expired. A single metadata-only search through the existing running daemon completed its normal OAuth refresh. The tests then copied that refreshed encrypted credential into disposable profiles without refresh/reconnect authority. No consent or provider permission configuration changed.

Command:

```sh
node scripts/verify-composio-readonly-e2e.mjs --live-source $OPENAG_DATA --outlook-profile --execute-outlook-profile-read --report /tmp/openag-outlook-session-results.json
```

Exit **0**. Each actual Claude/Codex adapter completed discovery, explicit full schema retrieval, and two separately approved `OUTLOOK_GET_PROFILE` requests for the existing single active account, exactly `user_id=me` and `select=[id,mail]`. The second read used the same real ACP session and frozen provider workflow as the first. Discovery/schema changes are forbidden during execution. Each read received a distinct OpenAg approval and provider `allow_once` response. No session-wide permission was selected. All four successful batch members returned the expected profile ID/mail, matched the discovered account, and were accurately reported by the real adapter.

| Adapter | Initial read | Reused session/workflow read |
| --- | --- | --- |
| Claude | `log_ZYXnqffVf4fi` | `log_LOeEy2nJDJpz` |
| Codex | `log_gNF1UGaK0R0K` | `log_UYR_1UbLn3tr` |

The four provider logs were independently retrieved and confirmed successful with exact tool/arguments, the same selected account, and a stable workflow within each adapter. The provider exposes no separate upstream HTTP status in these records; this acceptance establishes the returned profile read, not message-content access. [Sanitized machine-readable results](mcp-outlook-session-results.json) omit profile values and account/workflow identifiers. Full logs are private mode-600 files under `$OPENAG_DATA/diagnostics/mcp-session-outlook-acceptance/`.

Generic executor receipts remain Unknown. Before each adapter's second separately authorized read, its first returned profile was checked against the target and its **disposable acceptance receipt** inspected through the normal version-bound public method. No live receipt was changed. Source receipt/credential stability assertions passed. Live historical receipts #6–#8 remain Unknown and inspected; no pending approvals or open provider interactions remained on readback.

## Validation and review

- `node scripts/verify-mcp-session-lifecycle.mjs`: five standalone HTTP/SDK groups passed: reused capabilities after simulated eviction; paginated SDK output validation without replay; changed/duplicate catalogue and failed negotiation Not-run before dispatch; cancellation then a queued second bot preserves callback ownership; stalled handshake body stops at the 15-second connection deadline before dispatch.
- `node scripts/verify-mcp-contract.mjs`: 34 protocol probes passed, including stateful sessions, malformed/error responses, no automatic replay, elicitation and task-only diagnostics.
- `node scripts/verify-remote-mcp.mjs --contract-audit`: 18 controlled remote-MCP groups passed, including writes/unknown approval gating and receipt behavior. No providers in that check.
- `node scripts/verify-mcp-interactions.mjs`: gateway/React interaction checks passed, including explicit response, another-device decision and cancellation.
- `pnpm -r build`: passed; relay deployment was **dry-run only**. Initial help packaging failed at the eight-source limit; redundant references were replaced and the complete build passed without increasing limits.
- Daemon and desk `tsc --noEmit` passed. JavaScript syntax and whitespace checks passed.
- `node scripts/verify-bot-knowledge.mjs`: four packaged/default-bot delivery and permission groups passed. Knowledge changes: glossary terms, authoritative MCP lifecycle notes, delivered Computer and integrations handbook and source manifest.
- Reused independent reviewer cleared lifecycle/catalogue and harness fixes; separate Standards/Spec reviewers cleared after the packaging correction. `codex review --uncommitted` covered tracked/untracked changes and found no actionable defects. Reviews were read-only and did not run providers or tests.

No unit/Jest/Vitest runners, message/folder/attachment reads, external writes, permission weakening, PR or deployment. Passing this bounded profile journey does not establish every Outlook or connector tool.

## Final PR review follow-up

The branch review found an unbounded fresh-handshake response body and native-tool exposure in the acceptance process. A stalled-body fixture reproduced the first at 19 seconds before the fix; fresh negotiation now has a 15-second deadline that closes the client and records Not-run. The live harness disables Claude native tools, restricts Codex native capabilities, and rejects any native/out-of-scope adapter tool event. The final four-read Outlook rerun passed both real adapters with zero native tool events, and all four new full provider logs were independently verified. Focused independent and built-in uncommitted reviews cleared both fixes. No installed bot configuration was changed by the test restrictions.
