# Tool execution reliability

Status: owner approved proceeding with the implementation scope on 4 November 2026. Local contract verification and only reproduced execution fixes are authorized; merge, deployment and business-provider writes remain separate. See [acceptance and limits](../notes/tool-execution-reliability.md).

## Problem Statement

OpenAg already has centralized permissions, execution outcomes and action receipts. Its checks are spread across several campaigns. The owner needs evidence that the same action cannot be reported differently because it came through Ollama, another API provider or a fresh/reused ACP session.

This is a coverage and contract-hardening slice. The source review does not establish a new production defect or a measured reliability improvement.

## Solution

Map the existing checks against one shared behavior matrix. Prove one ordinary tool journey through both real ACP adapters first, including a second call in each session. Then fill concrete gaps through the real gateway and controlled transports. Fix only reproduced disagreements in the component that owns them. Retain existing permission, receipt and uncertainty contracts.

## User Stories

1. As an owner, I want refused actions to leave their targets unchanged, so that permission modes remain meaningful.
2. As an owner, I want the same authorization rules across runtimes, so that changing provider does not widen access.
3. As an owner, I want one daemon authorization for one forwarded action, so that ACP does not introduce duplicate or bypassed reviews.
4. As an owner, I want a second call in an existing ACP session checked again, so that reuse does not retain stale authority.
5. As an owner, I want approved edits to be the exact inputs executed, so that my review controls the action.
6. As an owner, I want changed contracts and permissions to invalidate stale proposals, so that old consent cannot authorize new behavior.
7. As an owner, I want cancellation before dispatch to prevent execution, so that a late approval cannot restart cancelled work.
8. As an owner, I want cancellation after dispatch to preserve uncertainty, so that I do not unknowingly repeat an effect.
9. As an owner, I want a nested provider error to remain visible, so that a returned response cannot masquerade as effect confirmation.
10. As an owner, I want confirmed failure distinguished from possible partial effects, so that recovery is safe.
11. As an owner, I want interrupted actions retained after restart, so that losing a process does not erase uncertainty.
12. As an owner, I want an unresolved Unknown to block unsafe repeats, so that retries do not duplicate effects.
13. As an owner, I want inspection to retain the historical result without replay, so that investigation stays read-only.
14. As an owner, I want the desk, model-facing result and retained receipt to agree, so that I can trust status reporting.
15. As an owner, I want private inputs and provider errors redacted, so that evidence does not expose secrets.
16. As an owner, I want cancellation and disconnect to release owned resources, so that unrelated activity can continue.
17. As a maintainer, I want acceptance to fail on provider-level failure, so that a green script proves the intended outcome.
18. As a maintainer, I want existing coverage reused, so that this work does not create a second execution framework.

## Implementation Decisions

- Begin with a coverage inventory; distinguish currently demonstrated behavior, missing coverage and reproduced defects.
- Keep one authoritative daemon permission and execution path. Preserve native ACP effect restrictions and exact own-server forwarding.
- Keep invocation completion distinct from effect confirmation. Do not globally reinterpret every returned result as success or every provider error as confirmed no-effect failure.
- Reuse existing outcomes, receipts, invocation identifiers, reviewed snapshots and redaction. Add no new persistence model, outcome vocabulary or public route without a demonstrated gap and an explicit plan revision.
- Fix shared behavior at its existing owner. Check the other runtimes and tools that share any corrected contract.
- Retain current Unknown fences, no-replay behavior, review expiry and permission-session revision checks.
- Teardown changes require a reproduced resource leak or stale-session defect. Identify the resource owner before changing cleanup; do not introduce a generic lifecycle framework.
- Link available request manifests to investigation evidence. A manifest proves input/handoff observation, not dispatch authority or target effects.
- Update authoritative help and bot knowledge only for changed user-visible behavior; describe verification-only work as such.

## Testing Decisions

- Reuse the agreed desk → gateway/runner/policy → target → retained result boundary. Check actual target state and execution count, not model prose or transport success alone.
- First run a bounded disposable local journey through each installed real ACP adapter, including its second same-session call and a refused action. Verify native bypass remains unavailable.
- Inventory and reuse existing standalone receipt, chat recovery, daemon execution, provider permission and hosted-outcome checks. Do not duplicate covered cases for script-count symmetry.
- Use real API/Ollama runtimes with controlled provider transports for deterministic scenarios. Exercise other API transports where result conversion differs; do not assume a count of provider names proves distinct contracts.
- Cover refusal, approved edits, stale authorization, cancellation before/after dispatch, nested errors, partial/lost outcomes, restart recovery and repeat prevention. Inspect both chat and Work paths where settlement differs.
- Control dispatch barriers and failure points explicitly; avoid timing-only races and concurrent Unknown scenarios. Unexpected Unknown stops effectful work pending inspection and owner direction.
- Check redaction and normal device access boundaries on retained evidence. If UI changes become necessary, verify reachable desk states using shared components on desktop and mobile.
- No unit/Jest/Vitest. Use builds and standalone integrated assertions with temporary data. Record exact command coverage, skipped gates and live-provider limits.
- Perform Standards/Spec review and a separate built-in Codex review before any separately authorized merge. Correct substantive findings and repeat affected verification.

## Out of Scope

Automatic context reduction or summarization; runtime replacement; new provider integrations; automatic retries/recovery/replay; relaxed permission modes; new receipt stores or generic lifecycle frameworks; real business writes; merge, deployment or external tracker publication.

## Further Notes

The request-provenance implementation is locally accepted but not deployed. Context reductions remain a later decision supported by observed pressure/omissions. This slice addresses the next concrete DSH research opportunity without claiming that all remaining research proposals must be implemented.

The domain model and existing glossary supply the language. The approved sequence is coverage inventory → both real ACP checkpoints → missing integrated checks and reproduced fixes → regression/knowledge verification → Standards/Spec and separate built-in review. The coverage inventory identifies the concrete script changes; application changes require a reproduced defect.
