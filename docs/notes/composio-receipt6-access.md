# Receipt #6 provider evidence access

3 November 2026, Pacific/Auckland. Follow-up authority: obtain actual provider evidence, reconcile only if justified, then finish the approved public GitHub metadata read through both adapters. No Outlook replay is authorized.

## Correlation prepared

The retained receipt records the `OUTLOOK_GET_PROFILE` action inside `COMPOSIO_MULTI_EXECUTE_TOOL`, a minimal profile field selection, and the historical session identity. Its timing is **10:07:16.700–10:07:17.189 AM NZDT on 3 November 2026** (21:07:16.700–21:07:17.189 UTC on 2 November). The result remains a clipped Enhanced Controls rejection. Shared notes omit the account alias and opaque session identity; the original receipt retains them for authorized correlation.

## Provider access attempted

- Read the official [Logs API](https://docs.composio.dev/reference/api-reference/logs): execution records can be searched by time/tool/session; detail supplies request, response, timing and correlation context. Access requires appropriate project credentials or an authenticated session. Consumer Connect and Platform project resources must not be conflated.
- Used the installed CLI's documented read-only `composio dev logs tools` command, filtered to `OUTLOOK_GET_PROFILE` and the one-minute window around the original attempt. The provider returned HTTP **401**, reporting an invalid or revoked user API key. This is an access failure, not evidence that the execution log is missing or that the action did not run. No login, key replacement, account change, provider action or feedback submission was attempted.
- The local browser tool repeatedly reports **“Local browser use is disabled in Work settings.”** The owner selected browser access, but the actual runtime permission remains disabled. No cookie extraction, native-browser workaround or permission bypass was used.
- A read-only live database check found receipt #6 is the only uninspected Unknown receipt and there are zero pending external/secrets approvals. No receipt inspection, outcome change or expiry was performed.

## Preparation while access is blocked

The live acceptance script now supports an explicitly requested `--execute-public-repository-read` phase only after all real external/secrets uncertainty blockers are clear. It mirrors all currently blocking receipts into disposable test profiles, rechecks the real fence before approval and dispatch, allows only one `GITHUB_GET_A_REPOSITORY` call per adapter with exactly `owner=ComposioHQ` and `repo=composio`, forbids workbench offload or additional tool actions, and requires independent provider-result comparison plus the actual adapter's name/description/URL answer. External-effect receipts remain Unknown; the script never invents write confirmation.

This is prepared source, not a passing positive-provider run. Syntax and independent static review are complete; runtime acceptance remains blocked on evidence access and justified reconciliation. The existing blocked mode continues to return exit 2.

## Required continuation

Enable actual local browser access in Work settings and use an authorized Composio dashboard session, or provide the matching provider execution log/details. Correlate tool, session, account and timestamp before using it as receipt evidence. A different project's empty log list is not proof of non-execution. Once the evidence justifies an owner inspection, record it through the normal version-bound API, preserve the historical Unknown outcome, read back the receipt and pending-proposal effects, and only then run the approved GitHub read through both adapters.

No tests using live providers, unit/Jest/Vitest runs, deployment or Outlook calls were performed in this follow-up. Raw CLI error output is retained only in private temporary files; no credentials are in this note.

## Provider evidence retrieved and receipt inspected

The owner authorized a CLI login refresh. The expired CLI session was replaced without installing skills or changing OpenAg's connector credential. The signed-in dashboard verified OpenAg uses the same consumer workspace. Developer-project logs did not contain this Connect execution; the CLI's existing consumer-project resolver supplied the correct consumer project, and the provider SDK's log-list/detail endpoints returned the full record.

Matching provider log: `log_ZwRRL3GVkZQB`; request `mcp_638187c5-63a`. The complete payload matches receipt #6 exactly, including the selected profile fields and original session/account. Provider timing is 10:07:17.003–10:07:17.054 AM NZDT. It records an unsupported-client elicitation rejection for the sole `OUTLOOK_GET_PROFILE` entry: `success_count=0`, `error_count=1`, `steps=[]`, `logs=[]`, and no upstream HTTP status. The shared note omits account/session identifiers and private profile data. Raw provider evidence is retained in a private mode-600 temporary file.

The owner/version-bound inspection API accepted this reference after the receipt payload and review version were rechecked against the provider record. Readback confirms receipt #6 remains **Unknown** and is now inspected. There were zero pending external/secrets approvals before inspection. This is historical provider-rejection evidence, not successful Outlook access or a rewrite of history.

The first subsequent exact public GitHub metadata read through the real Claude adapter reached Composio but was rejected for **no active GitHub connection**. Provider log `log_snx4HpTsimX0` matches `GITHUB_GET_A_REPOSITORY(owner=ComposioHQ, repo=composio)`, has zero successful tools and no upstream HTTP status. This is not positive repository-read acceptance. The harness now retains a provider rejection as a failed result, continues adapter coverage, and supports selecting one adapter to avoid repeating the already inspected attempt.

The owner separately authorized a fresh bounded Outlook read after inspection; that later check is distinct from historical receipt #6. No deployment is authorized or performed.

## Subsequent real checks

Both real Claude and Codex completed Composio discovery/schema and dispatched the exact approved public GitHub metadata request. Both provider records reject execution for no active GitHub connection: Claude `log_snx4HpTsimX0`, Codex `log_ZSB-IGVVtQkU`. The Codex report exits 1 and records the actual provider rejection. A prior Codex attempt was correctly stopped when the concurrent fresh Outlook receipt changed the live fence; it was rerun only after inspection. Positive GitHub data acceptance remains pending connection consent. The owner chose to connect GitHub with Always Ask; no grant was accepted by the agent.

Two owner-authorized minimal Outlook profile attempts returned no profile. First, provider log `log_0QSR6ojignKC` shows an unanswered permission prompt (the test watcher initially listened for the wrong event name). The next attempt had its watcher ready for the actual interaction event, but provider log `log_AUWPE9aet2UU` instead rejected the client as not supporting elicitation and emitted no prompt. Both full provider logs match the local requests and report zero successes, no execution steps/logs, and no upstream HTTP status. Their new local receipts were inspected through the version-bound API with readbacks; historical Unknown outcomes remain. These checks establish inconsistent permission-prompt behavior, not working Outlook access. No messages, folders or attachments were requested. No further Outlook calls will run in this task.

The public GitHub harness now handles only an exact repository-read form for the single active account returned by discovery. It answers `allow_once` after the exact OpenAg proposal was approved, rechecks the live uncertainty fence, rejects all other forms/URLs or ambiguous accounts, and never changes provider permission defaults. Actual provider responses remain required for a pass.

## Final GitHub acceptance

After owner-managed GitHub consent, the final two-adapter run exited 0. Claude and Codex each completed actual Composio discovery, full schema, one exact approved public repository read, one provider `allow_once` response, and an adapter answer matching independent GitHub metadata. Provider success logs: Claude `log_Y51rqesOgOHA`, Codex `log_mJ3oRmFd3oKG`. The final machine-readable report is `composio-readonly-live-results.json`. Earlier blocked/rejected attempts above remain part of the chronology; they are not represented as successes. No Outlook call occurred in the GitHub harness. No deployment occurred.

Full receipt #6 evidence and API readbacks are now preserved in private durable diagnostics rather than only temporary files: `$OPENAG_DATA/diagnostics/receipt6-provider-inspection/`. Provider success records are in the adjacent `composio-github-read-acceptance/` directory. Neither directory is product/bot knowledge.
