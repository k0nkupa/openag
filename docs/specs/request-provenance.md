# Request provenance and context visibility

Status: owner-approved implementation baseline, 4 November 2026. The owner approved the plan and end-to-end verification boundary. Source acceptance and deployment are tracked separately in OA-434 and `docs/notes/request-provenance.md`. External issue publication is unconfigured.

## Problem Statement

When an agent misses information or behaves differently after a long conversation, the owner cannot reliably see which context, tools and settings were supplied for that decision. The transcript shows retained activity, but it does not establish the exact selection made for each model step. Provider reports and ACP session history also have different visibility limits.

## Solution

Let the owner open Request details from a turn's existing activity/evidence surface. Show a concise per-step account of selected sources, omissions, offered tools, model settings, attempts and known usage. Detailed identifiers remain expandable; ordinary chat receives no routine diagnostic messages.

Use a bounded request manifest with an explicit observation boundary. API and Ollama record the request inputs visible at their daemon-owned seam. ACP records only OpenAg's handoff and whether the external session was new or reused. Unknown information is labelled unavailable. No request or tool is replayed by viewing a trace.

## User Stories

1. As an owner, I want to inspect a model step, so that I can understand the information supplied for its response.
2. As an owner, I want selected history boundaries, so that I can distinguish unavailable context from ignored context.
3. As an owner, I want omitted or shortened sources and reasons, so that I can supply missing information deliberately.
4. As an owner, I want current input distinguished from conversation history, so that earlier messages are not mistaken for the present request.
5. As an owner, I want instructions separated from supporting context data, so that evidence is not presented as action authority.
6. As an owner, I want memory, recall, handbook and skill references, so that I can identify where context came from.
7. As an owner, I want source version/fingerprint availability stated, so that later edits do not appear to have been part of an earlier request.
8. As an owner, I want attachment references without duplicated private contents, so that I can understand inclusion without retaining another payload copy.
9. As an owner, I want offered tool identities and schema fingerprints, so that I can inspect the tool contract available for a decision.
10. As an owner, I want offered tools distinguished from executed operations, so that a catalogue is not mistaken for an effect.
11. As an owner, I want requested model/reasoning separated from returned evidence, so that configuration is not represented as proof of what ran.
12. As an owner, I want permission-session revisions and turn limits identified, so that I can interpret the instructions supplied to the agent.
13. As an owner, I want each later model step traced, so that tool-result context is not hidden behind the initial prompt.
14. As an owner, I want retries grouped under their original step, so that request attempts do not look like repeated tasks.
15. As an owner, I want preparation, dispatch-start and settlement distinguished, so that a prepared record is not claimed as provider receipt.
16. As an owner, I want cancellation and interrupted response evidence retained, so that incomplete processing remains visible.
17. As an owner, I want context pressure labelled by its measurement basis, so that text-length estimates are not presented as token counts.
18. As an owner, I want provider-reported usage qualified, so that missing usage is not presented as zero.
19. As an owner, I want an admission refusal recorded, so that oversized required context does not disappear silently.
20. As an owner, I want the same inspection concept across Ollama, DeepSeek and other API providers, so that diagnostics do not depend on model branding.
21. As an owner, I want ACP handoffs labelled honestly, so that I do not assume visibility into a CLI's internal model requests.
22. As an owner, I want reused ACP sessions identified, so that a prompt delta is not mistaken for the whole retained context.
23. As an owner, I want delegated turns to have their own bounded manifests, so that one agent's trace does not expose another context without authority.
24. As an owner, I want historical turns without manifests labelled Not recorded, so that later reconstruction is not sold as original evidence.
25. As an owner, I want manifests retained through restart, so that troubleshooting does not depend on transient memory.
26. As an owner, I want credentials and raw provider bodies excluded, so that diagnostics do not become another secret store.
27. As an owner, I want trace access checked at the gateway, so that a URL or source reference does not grant access.
28. As an owner, I want an evidence gap to remain explicit, so that a recording failure never justifies rerunning an operation.
29. As an owner, I want concise summaries with expandable details, so that normal conversation remains readable.
30. As an owner, I want action receipts and Unknown guards preserved, so that input diagnostics cannot weaken execution safety.

## Implementation Decisions

- Keep the existing daemon, runtimes, ledger, policy gate and receipts. No Cordis/plugin framework or replacement persistence engine.
- Extend existing glossary concepts: Turn, Model step, Model-request attempt and Turn context. A hosted request manifest belongs to one step; each retry attempt references it. ACP handoff records use a handoff sequence and actual observed prompt/session boundary, with the hidden child model-step identity unavailable.
- Preserve source attribution during context preparation. Record selected/omitted authorized message ranges and supporting source descriptors, including omissions caused by history limits, text budgets, unsupported attachment representation and unavailable sources. Never enumerate unauthorized sources.
- Observe final SDK request inputs in the API runtime and the assembled chat payload at Ollama's daemon transport. Initial turn preparation alone is insufficient for later steps. Fingerprints match the observed redacted representation, not an unobserved provider-native wire request.
- Observe ACP handoff/configuration and fresh/reused session context only. Hidden child context, compaction, model requests and usage remain unavailable unless independently reported with a qualified source. Apply to both supported adapters.
- Persist a versioned, bounded manifest and append-only preparation/attempt/outcome evidence through the existing ledger/redactor. Preserve a durable manifest identity and step/attempt links. A read projection may index those records; there is one authoritative record, not a parallel execution log.
- Include turn/agent/conversation identities, step/attempt references, source descriptors, selection boundaries, omission counts/reasons, offered tool schema fingerprints, allowlisted model/reasoning settings, permission-session references, independent turn restrictions and observation-boundary labels. Link existing action receipts where available without changing them.
- Do not store complete prompts, attachment bytes, connector response bodies, raw HTTP headers or unrestricted provider options. Apply redaction before persistence and fingerprints. Digests/references cannot reconstruct mutable source content; the UI states that limitation.
- Bound record size and list lengths. Summarize overflow with explicit counts/reasons rather than silently losing fields. Reuse existing step/attempt limits to prevent unbounded trace growth. Define concrete size caps and migration/index shape in the implementation plan before coding.
- Persist required preparation evidence before dispatch. If persistence fails, refuse that request before transport. Cancellation before dispatch produces no started attempt. Started means an invocation was initiated, not that a provider received or processed it. Later settlement gaps never cause automatic replay.
- Keep requested configuration, response-reported model and provider-reported usage distinct. Missing values stay unavailable. Label units explicitly: current text admission uses string-length units; image representation and provider tokens are separate. This slice reports omissions/pressure without changing selection or budgeting.
- Add bounded, paginated gateway inspection of a turn's manifests for owner/Full access. Reject unauthorized reads at the gateway, preserve private/hidden-room rules and avoid additional absolute host paths or credential-bearing references. Limited devices receive no new diagnostic authority.
- Reuse the existing turn activity/evidence UI with a Request details entry. Show scope, per-step selection/omission summary, model settings and attempt outcomes first; keep identifiers and schemas expandable. Do not add a new settings dashboard or chat disclaimers.
- Preserve model-request retry policy, action Unknown guards, approval and permission semantics, output truncation/incomplete outcomes, delegation boundaries and isolated/offline/unattended restrictions. Instrumentation must not create a second request loop or execute tools itself.
- Existing turns are not backfilled from current instructions or transcript guesses. Unknown versions, missing sources and partial observation remain explicit.

## Testing Decisions

The owner accepted one highest practical seam: desk chat → actual gateway/runner → daemon request or ACP handoff → durable manifest → owner inspection in the desk. Check externally visible selection, requests, results and retained evidence; do not test helper names or mirror the implementation.

- Use temporary data and the actual compiled desk/gateway/runner. Controlled provider transports capture the dispatched request and return deterministic responses. Assert manifest-to-observed-request agreement at the declared observation boundary.
- Cover Ollama, DeepSeek and the configured API provider matrix, including later tool steps and a second request in the same conversation. This is controlled transport acceptance, not live hosted-provider acceptance.
- Run bounded journeys through both real ACP adapters with a second call in the reused session. Prove handoff deltas, new/reused context and qualified unknown internals; reject native-tool bypass as in the permission campaign. Fixtures alone do not establish installed adapter behavior.
- Include selected/omitted history, required-input overflow, source mutation, catalogue change, attachment representation, recall omission, Unicode/units and unavailable usage. Assert existing prompt selection/outcomes are unchanged by instrumentation.
- Exercise one step with multiple model-request attempts, partial-stream interruption, cancellation before/after dispatch and restart. A retry must keep the same observed projection or explicitly report a different request; no tool markers may repeat.
- Verify a prior Unknown action still blocks effectful execution, provenance inspection changes no receipt or approval, and a delegated trace respects its own context boundary.
- Seed secrets in instructions, source descriptors, arguments, provider errors and settings; assert they do not appear in stored manifests, trace responses, displayed details or diagnostic logs. Assert owner/Full access and direct-URL refusal for Limited devices.
- Simulate preparation-record persistence failure before transport and settlement failure after dispatch. Assert no unrecorded new request starts and no automatic retry/replay follows the evidence gap.
- Inspect actual desk desktop/mobile layouts, structured summaries, expanding details, empty/historical/error states and cross-device refresh. Update delivered help only when behavior exists and verify packaged delivery to API, Ollama and cached ACP/MCP paths.
- Prior art: the existing standalone permission/provider matrix, request-retry transport checks, ACP continuity checks and packaged bot-knowledge journey. Builds/typechecks and focused standalone gateway/browser assertions replace unit/Jest/Vitest runners, which are prohibited.

## Out of Scope

Exact request replay; complete payload/snapshot retention; raw credential/provider-body logging; observing hidden ACP internals; installing DSH as another runtime; new plugin frameworks; automatic summarization/compaction; altered context selection; new retry/recovery behavior; tool concurrency changes; changed permissions or connector consent; backfilling original evidence; spend prediction; live provider/business actions or deployment of an unimplemented feature.

## Further Notes

This DSH-inspired slice follows the completed permission campaign. The pinned research is design input, not a live upstream compatibility claim. The owner approved its implementation plan on 4 November 2026.

The accepted retention boundary is metadata/references/fingerprints with explicit limits. Full snapshots would offer stronger reconstruction at a larger privacy and retention cost; that choice remains outside this slice. The approved plan fixes a 16 KiB manifest limit, bounded descriptor lists and index-only migration; the implementation note records the final storage contract.

Design references: the repository glossary, request-provenance domain model and accepted ADR 0005. The verification seam was confirmed in this chat. No new model requests, provider actions or runtime acceptance are claimed by this document. External issue publication requires `/setup-matt-pocock-skills` tracker/label configuration; no ready-for-agent label or external issue has been created.

Implementation and scoped acceptance: `docs/notes/request-provenance.md` (OA-434). Plan approved 4 November 2026; deployment remains separate.
