# MCP invocation results and external-effect verification

OA-474, 5 November 2026. Owner requested the shared reporting fix and deployment, paused the work, then resumed it. This change is separate from `974094b`'s scoped receipt conflicts and inspection.

## Scope and contract

Kind: shared managed/configured MCP client, runner, scoped ACP server and receipt reporting. No new connector, credential, permission mode, API route, tool offering or framework is introduced. Unknown names keep their opaque permission requirement. Existing reviewed Composio read slugs still control confined admission only; they no longer decide result reporting.

After authorized dispatch, a clean returned MCP result records Completed and a returned MCP error records Failed. Managed Composio envelopes are validated before this decision for every tool name; nested batch failures, mismatched/missing results, malformed envelopes and proxy HTTP failures cannot pass through outer success. Returned errors preserve their evidence and error flag. The daemon notice retains the no-automatic-repeat instruction for external actions, including returned failures. The separate daemon-owned `effectVerification: not-checked` survives in result envelopes, ledger/runner outcomes and receipt evidence. The receipt displays External change verification: Not checked. A completed invocation does not independently verify a downstream write and never grants permission to retry.

Transport loss, cancellation or interruption without a returned result can still be Unknown. Existing historical outcomes are not rewritten. Non-MCP tools keep their own execution/effect contracts. No inspection tool or receipt conflict gate is introduced, and the permission classes, own-property lookups, user/provider consent, unattended/offline ceilings and native-tool restrictions remain intact.

The safe target is the local synthetic MCP server's fixed marker. Both actual subscription adapters use disposable data and only the exact offered daemon tool, with native bypasses disabled. Each calls an unfamiliar tool and then makes a second explicit call in the same ACP session. Independent verification compares the server call count, daemon canonical result, receipt and returned wire payload; it does not infer completion from model text. There are no real provider writes or account reads.

The saved Inbox receipt `01394055-e924-4e53-be2f-06a746851bf6` is a second evidence source. An offline replay of its retained `OUTLOOK_GET_MAIL_FOLDER` request/response through the changed normalizer and confirmer records Completed with effect verification Not checked, while `composioReadRequest` still refuses to classify that slug as a confined read. The historical live record is unchanged. No Outlook call is repeated.

## Coverage and limits

| Layer / known failure class | Evidence |
| --- | --- |
| Identity, original case/charset, aliases and central policy | Existing manager/registry unchanged; standalone ACP identity and remote-MCP declarations/refusals. |
| Returned invocation versus effect confirmation | SDK HTTP manager/runner Composio checks cover familiar/unfamiliar tools, future connector slugs, writes, errors and another server; receipt and wire fields checked separately. Baseline regression failed before the fix. |
| Nested provider failure / harness honesty | Composio checks fail on nested errors, missing/mismatched results and malformed success, even with transport success; outer MCP error flags remain errors. |
| Actual Claude / Codex adapters and session reuse | Both real adapters passed the bounded unfamiliar-tool journey and a second call with the same ACP session ID. No provider account was contacted. |
| Fresh/stateless sessions, callbacks, catalogues, task/schema limits | Existing shared MCP contract and session-lifecycle checks; real runtime boundary exercised by the paired adapter journey. |
| Approval versus provider input | Permission code unchanged; existing interaction gateway/React checks cover explicit responses and provider prompts. No new live consent was requested. |
| Cancellation / pending decisions / restart | Integrated API/ACP/Ollama lifecycle and action-receipt checks preserve Failed versus Unknown versus Not run, single-use execution, old receipt history and no automatic replay. |
| Credentials and integration isolation | Shared redaction/bounding retained; connector-isolation and lifecycle checks. No credentials in shared evidence. |
| Default bot knowledge | Updated approvals handbook, canonical MCP notes, trusted ACP instructions and aligned AGENTS/CLAUDE guidance. Four packaged/API/Ollama/cached ACP/replacement-default delivery groups check delivery. Instruction hashing replaces outdated ACP context. |
| Desktop/mobile appearance | One text field in the existing native receipt Card/Badge composition; shipped-DOM check verifies Tool result / Succeeded and separate Not checked evidence. Cua browser review is unavailable because local browser use is disabled. No screenshot or physical-device claim. |
| Live provider acceptance / writes / owner-confirmed use | Not exercised; offline retained-provider replay and real-adapter synthetic checks are distinct from live provider acceptance. |

The receipt verifier needed to finish its earlier disposable pending review before preparing the optional capture fixture. The bot-knowledge assertion was updated from the retired universal effect-unconfirmed message to the new invocation/effect explanation. Neither correction weakens production gates.

Exact command outcomes and the deployment readbacks are recorded in the ticket Log and release record. No unit/Jest/Vitest suite is run. No source-only or controlled result is presented as deployment, real provider acceptance or device delivery.
