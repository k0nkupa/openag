# OA-390 Composio read-only acceptance

Scope: owner-approved twelve-tool review and real-adapter/actual-Composio metadata path for public `ComposioHQ/composio` repository metadata. Source branch `codex/composio-readonly-acceptance`, based on PR #16 main. No deployment. Later owner authority allowed CLI login refresh, evidence-based receipt inspection, owner-managed GitHub connection consent, and bounded Outlook profile checks; those follow-ups are recorded below.

## Source change

The exact daemon-managed Connect identity uses one reviewed declaration for all twelve offered tool names. Tool/skill search is Search; tool schemas and skill loading are Read. Wait/connection management, batch/proxy execution, shell/workbench, skill changes and feedback remain external actions. New names and matching names on another server receive no automatic read authority. Existing stricter bot modes and protected administrator declarations remain authoritative. No provider hints or model-selected wording classify an action.

Known managed-tool envelopes are interpreted before generic result capping. Explicit provider failures, invalid envelopes, failed batch items and upstream proxy HTTP failures cannot become completed reads solely because MCP returned a response. Untrusted diagnostics/provider log references survive capping/redaction. External execution still has an unconfirmed effect; this is not a provider readback implementation or an automatic receipt reconciliation.

The adaptation follows CopilotKit/OpenBot's diagnostic and envelope-validation patterns, without importing its project-key broker or changing consumer Connect OAuth. [Pinned source review](composio-oss-source-review.md). The complete offered surface and future journeys remain in [the E2E map](composio-e2e-test-map.md); classification coverage is not live execution coverage for every tool.

## Receipt #6 reconciliation

Full matching consumer provider log `log_ZwRRL3GVkZQB` was retrieved after the owner-authorized CLI refresh. The payload, session and timestamp match the original receipt. The sole profile entry was rejected for unsupported elicitation, with zero successes, no execution steps/logs, and no upstream HTTP status. The normal owner/version-bound inspection API recorded that evidence; readback preserves the historical **Unknown** outcome and confirms inspection. No previous execution was replayed as part of inspection. Full private evidence and API readbacks are retained under `$OPENAG_DATA/diagnostics/receipt6-provider-inspection/` (private directory/files); shared notes contain no credentials or private profile data. See [the evidence chronology](composio-receipt6-access.md).

The owner later authorized fresh minimal Outlook profile reads. One failed at an unanswered provider prompt; the following attempt rejected the client as not supporting elicitation and emitted no prompt. Both failed attempts were independently inspected through matching full provider logs and the normal version-bound API. Historical Unknown outcomes remain. Outlook access is **unverified**; no messages, folders or attachments were requested, and no further Outlook call is running. These results do not establish a cause for the inconsistent prompt behavior.

## Initial source and controlled checks

- The new standalone manager/runner test first failed at the exact schema classification (`act-external` instead of `read`). After the fix, `node scripts/verify-composio-contract.mjs` passes seven synthetic HTTP groups: all known/new names and source isolation; metadata execution; explicit/structured/malformed/large provider errors with log references; partial batch failure; proxy HTTP failure; earlier Unknown fence preserving metadata reads while blocking execution; oversized arbitrary remote diagnostics cannot hang the daemon (isolated child-process timeout). The diagnostic test first reproduced the hang before the fix.
- `pnpm -r build` passed (relay dry-run only); daemon and desk `tsc --noEmit` passed.
- Controlled remote-MCP regression passed 18 groups. The protocol regression passed all 34 probes, including a deterministic fixture fix: wait for the server's notification stream registration before sending a catalogue notification, rather than racing that subscription.
- Packaged help delivery passed four groups after updating the assertion to the expanded metadata declarations. Receipt regression passed.
## Actual provider read acceptance

The initial real-adapter run completed discovery/schema but correctly stopped before execution at the mirrored unresolved receipt fence (exit 2). After receipt inspection, both adapters reached the actual executor; the provider rejected GitHub because no account was connected. Those failures did not count as passing reads. The owner then completed GitHub connection consent with Always Ask. Test guards declined a permission prompt whose display-account label did not match the expected internal ID; provider logs confirmed those requests were declined before execution. The guard now binds either exact label to the same single active account returned by discovery.

The final command was:

```sh
node scripts/verify-composio-readonly-e2e.mjs --live-source $OPENAG_DATA --execute-public-repository-read --report /tmp/openag-composio-github-verified-results.json
```

Exit **0**. Both actual Claude and Codex adapters completed search → complete discovered schema → exact public repository proposal → OpenAg approval → actual provider form answered **allow_once** → actual `GITHUB_GET_A_REPOSITORY` → adapter answer. Each adapter performed one executor call and one provider permission response in this final run. The name, description and URL in the real Composio result matched an independent public GitHub baseline. The baseline was only comparison data, never a substituted result.

Provider success logs: Claude `log_Y51rqesOgOHA`, Codex `log_mJ3oRmFd3oKG`. Full provider records are retained privately under `$OPENAG_DATA/diagnostics/composio-github-read-acceptance/`. [Machine-readable results](composio-readonly-live-results.json) record both full provider-read passes, matching schema hashes and the reviewed twelve-tool catalogue.

The harness uses disposable profiles and the existing encrypted OpenAg connection. It does not refresh that credential, reconnect, change provider permissions, use another plugin's connection, read repository contents/mail or call any other executor. It preserves and rechecks all actual live external/secrets uncertainty blockers. Provider forms are accepted only for the exact repository read, the single discovered active account, and `allow_once` after the approved proposal; other forms/URLs and ambiguous accounts are refused. Generic external receipts remain unconfirmed rather than inventing write confirmation. Source receipt and credential-file assertions passed. Failures exit nonzero and are retained; `--adapter claude|codex` supports focused recovery without repeating the other adapter.

## Knowledge, review and limits

Updated authoritative Composio/MCP explanations, approvals/computer handbook and manifest. The packaged test exercises configured default-bot replacement and API/Ollama/cached ACP/MCP delivery. Independent Standards/Spec review and focused fixes are clear. Built-in full uncommitted review found the oversized-diagnostic hang; it was reproduced and fixed. The independent reviewer and focused built-in follow-up cleared that fix. The follow-up focused review found a possible false pass on nested batch errors; the harness now rejects normalized errors and requires exactly one successful matching batch member before comparing its data. The same reviewer cleared the fix, and both real adapters passed the strengthened run. No remaining actionable review findings.

No unit/Jest/Vitest suites were run under the current owner rule. The follow-up ran syntax/whitespace checks and the actual adapters/provider; prior source build and controlled-check results above were not rerun for harness/evidence-only edits. Browser/phone layout, organization skill reads, Outlook acceptance, and the other mapped provider/write journeys are not claimed as accepted. GitHub consent was completed by the owner, not automatically granted by the harness. New source has not been deployed. The earlier catalogue JSON is explicitly a historical passive snapshot and retains its then-current classification values.
