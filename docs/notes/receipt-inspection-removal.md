# OA-469: receipt inspection removed

5 November 2026. Source implementation on `codex/remove-receipt-inspection`; no deployment or live receipt mutation.

## Behavior

The target/reference and findings form, inspection API, receipt Recovery entries, historical-Unknown action/model/agent-request blocks, global pending-action receipt serialization and inspection-epoch invalidation are removed. Normal permission decisions, pending reviews, current-context checks and single-use approved receipt execution remain. Ordinary Work recovery and missing-tool-result handling remain separate features.

Unknown remains an honest historical outcome. No existing database record is rewritten, no uncertain action is marked successful, and nothing is automatically replayed. Legacy inspection columns remain inert for database/history compatibility. A new authorised operation can execute without requiring a manual acknowledgement of older outcomes.

The separate permissions chat's uncommitted scope/conflict implementation is not included. Its bounded inspection tools and other work need separate reconciliation; reintroducing its receipt conflict/inspection layer would conflict with this owner-directed removal.

## Checks performed

All use temporary data and controlled transports unless described otherwise. No unit/Jest/Vitest runners ran.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed; workspace initially had no installed dependencies. |
| `pnpm -r build` | Passed; relay deploy is dry-run only; existing Vite chunk advisory. |
| `node scripts/verify-chat-receipt-recovery.mjs` | Passed: retained chat evidence, no receipt Recovery/model lock, removed endpoint returns 404. |
| `node scripts/verify-action-receipts.mjs` | Passed: exact decisions, stale/duplicate refusal, fresh actions after Unknown/restart, no replay, shipped DOM without inspection fields. |
| `node scripts/verify-permission-sessions.mjs` | Passed: all presets, pending/revision/owner gates, automatic receipts, Unknown history without cross-chat/restart blocks. |
| `node scripts/verify-attention.mjs` | Passed: questions, Work recovery, counts/paging and retained Unknown. |
| `node scripts/verify-agent-requests.mjs` | Passed: 37 controlled cases; specialist effects and accepted dispatch remain available after Unknown, with completed request assertions. |
| `node scripts/verify-cancelled-recovery.mjs` | Passed: old cancelled missing-result review remains distinct; pending and active operation gates retained. |
| `node scripts/verify-composio-contract.mjs` | Passed: 8 controlled protocol groups; historical Unknown does not block new authorised operations. |
| `node scripts/verify-permission-adoption.mjs` | Passed: history preserved, explicit adoption, Read Only authority and restart. |
| `node scripts/verify-permission-worlds.mjs` | Passed after fixing fixture import order before platform simulation; no production confinement change. |
| `node scripts/verify-hosted-outcomes.mjs` | Passed: retained nested failures and outcomes, cancellation, approval recovery without replay. |
| `node scripts/verify-tool-execution-reliability.mjs` | Passed: integrated API/ACP/Ollama controlled lifecycle cases. One earlier run overlapped a rebuild and lost generated migration files; rerun after build passed. |
| `node scripts/verify-acp-continuity.mjs` | Passed: 8 controlled Claude/Codex pause, reuse/restart, isolation and cancellation groups. No real subscription journey. |
| `node scripts/verify-permission-providers.mjs` | Passed: controlled fourteen-provider matrix and nested boundary evidence. No live provider calls. |
| `node scripts/verify-bot-knowledge.mjs` | Passed: 4 packaged/API/Ollama/cached ACP-MCP/default replacement delivery groups. |
| Changed standalone scripts: `node --check`; `git diff --check` | Passed. |

Independent Standards and Spec source reviews finished clear after correcting stale fixture expectations. The live Composio acceptance script was updated by source/syntax verification only: provider execution always requires explicit opt-in and never depends on a historical fence.

## Knowledge and remaining acceptance

Updated delivered approvals, conversations, models and Work help; authoritative action-receipt, conversation, permission-session, MCP, App and agent-request notes; trusted ACP instructions (content hash invalidates cached/resumed instructions); aligned AGENTS.md and CLAUDE.md. Packaged delivery was verified above. Existing installed bots receive the new help/instructions only after deployment, which is not authorised here.

The component audit records controlled DOM coverage. **Rendered acceptance remains blocked:** Cua reported `Local browser use is disabled in Work settings`. Desktop/phone screenshots and physical interaction are unverified. OA-469 remains unchecked for this gate. No real adapter/provider acceptance, merge, push, deployment or live data changes occurred.

## Subsequent authorised deployment

The owner subsequently authorised local-main merge and deployment, including the current committed UI. The removal was reconciled as OA-469 and deployed at merged source `46f7cdf`. Backup, protected-state fingerprints, process/assets/feature readbacks passed. See local release record. The rendered-browser limit above remains.
