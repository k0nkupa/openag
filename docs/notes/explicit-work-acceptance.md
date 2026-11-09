# OA-342 remaining acceptance

Verified 2 November 2026 against source `0bf559b`. This follow-up changes acceptance records only. The browser was enabled for this run; the previous browser blocker no longer applies.

| Gate | Result |
|---|---|
| Desktop, 1440 × 900 | Plain chat adds no Work; proposal appears in Needs you with assignee and source; Accept creates one ready item with zero execution turns; Start causes exactly one turn; Ignore leaves no rejected Work card or row. |
| Phone width, 390 × 844 | Same flow through the mobile drawer and approval controls; Work origin and separate Start remain readable; no document horizontal overflow. This is responsive-browser acceptance, not physical-phone or WebRTC-network acceptance. |
| Real Codex ACP | Installed `@agentclientprotocol/codex-acp` with reported `gpt-6.1-sol`, medium. Plain chat returned `OA342_REAL_CHAT_OK` with zero Work. Actual scoped-MCP create_work waited for the owner decision with zero Work. UI acceptance created one item; the model returned its ID and did not start it. UI Start then produced `OA342_REAL_WORK_STARTED` in exactly one Work turn. |
| Review and controlled gates | Prior build, typecheck, nine standalone checks and review remediation remain applicable. No runtime source changed in this acceptance follow-up. |
| Isolation | Fresh temporary database, bot workspaces, device pairing and loopback server. Only create_work was exposed to the real adapter. No live instance, connectors, business records, external communications or credentials were changed. |

The temporary instance had three accepted synthetic Work items: two controlled UI checks and one real adapter check. Both rejected UI proposals were absent. No approval remained pending. Detailed IDs and assertions are retained in acceptance.json.

!Desktop ready-to-start Work

!Phone ready-to-start Work

!Real Codex waiting for approval

OA-342 is complete. Next is OA-355's approved hosted-context and execution-outcome design. This acceptance does not deploy either ticket.
