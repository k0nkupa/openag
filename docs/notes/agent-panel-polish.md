# OA-380 agent panel polish

3 November 2026. Local source and disposable browser preview only. The installed service was not changed or restarted. Screenshots contain controlled sample data.

| Before | After | Why |
| --- | --- | --- |
| Names and handles only in room creation | Existing BotAvatar beside each option | Recognise agents consistently with the sidebar |
| Results could vary in height below a maximum | Fixed 240px results area with internal scrolling | The sheet stays stable with 100 agents and during search |
| 32px tab container with taller buttons | Auto-height tab list and a shared 24px content gap | Content starts below the full tab header in room, direct-chat and selected-Work panels |
| Verbose room IDs, report timestamps and status lines | Model/effort badges, lead and approval-needed badges | Keeps the summary scannable; full report detail remains in bot settings |
| No active turn / Working text | Idle has no line; working dots stay below the avatar | Gives active-state feedback without moving the row |

## Motion decision

Purpose: state indication. This is a passive working-state indicator, not an animation on selection or a keyboard shortcut. CSS animates opacity only, with a calm 1.2s linear repeating cycle and staggered dot phases. The longer period is for continuous status, not a delayed UI transition. Reduced motion retains static visible dots. No motion dependency or hover interaction was added.

## Model evidence

Model and effort evidence are selected independently from current-revision reports in the current conversation. A later returned-model report cannot erase an earlier session effort. When a field has no applicable report, the loaded saved model configuration supplies that field. Loading/unavailable state never substitutes an ACP adapter identifier for a model. A configuration revision change reloads model details and invalidates the old cached configuration/report evidence. Full reporting is in the agent’s conversation side panel, Settings, Model and reasoning.

## Controlled browser checks

`node scripts/preview-agent-panels.mjs` starts a disposable gateway with exactly 100 agents, saved avatars and current/stale/other-room model reports. It prints a temporary pairing code and accepts working/idle/work/pair/stats on stdin. It uses controlled transports and starts no inference. Ctrl-C removes its owned temporary data.

Observed through the actual built desk:

- 100 options and 100 avatars; result height 240px, scroll height 3608px. Search kept the same height. Keyboard End scrolled inside the list. Handles and avatar attributes matched the saved agent identity.
- Room, direct-agent, selected Work and Files panels had a measured 24px tab/content gap. Long names truncated without horizontal overflow.
- Phone-width room panel and picker had no document overflow; the picker stayed at 240px. Temporary viewport overrides were reset.
- Current room reports supplied 6 Astra and low effort. Other room only and Stale model sample labels were absent.
- Advancing the controlled configuration to a new revision suppressed the old model and effort reports. The badges showed configured gpt-6-astra and medium effort.
- New current-revision session evidence with low effort followed by a model-only response showed returned 6 Astra plus reported low, instead of the configured medium.
- Direct chat used configured model/effort and did not borrow the named room's runtime report.
- turn_started showed a status indicator anchored below the avatar; turn_finished removed it. Idle had no status line. prefers-reduced-motion emulation produced animation-name none for all dots; emulation was cleared.
- Approval-needed presentation and pulse suppression were retained and reviewed in source. No approval was decided, no external action ran, and no live data was changed.

Screenshots: 100-agent picker, room panel, phone picker, phone panel, selected Work, direct chat.

## Validation and review

- `pnpm -r build`: passed; relay deployment was dry-run. Desk build/typecheck reran after the model-evidence corrections and passed.
- `node scripts/verify-room-creation.mjs`: passed controlled gateway/storage compatibility.
- `node scripts/verify-bot-knowledge.mjs`: passed four packaged API/Ollama/cached ACP/MCP/default-bot delivery groups.
- Preview script Node syntax, Markdown links and whitespace checks passed.
- Independent Standards/Spec reviews and focused follow-ups are clear after correcting adapter fallback and configuration revision handling. Built-in `codex review --uncommitted` found the model-only response/effort issue; the fix and focused re-review are clear, with the browser evidence above.
- Existing RoomRail component fixtures were updated but not executed. No unit/Jest/Vitest runners, PR, merge or deployment.

Knowledge updated: conversation and room-creation notes plus the delivered conversations and room-creation handbook topics. Source/controlled acceptance does not claim deployment, real model inference or physical-device gesture acceptance.
