# Main merge into composer dictation — 4 November 2026

Historical record of the first merge (`742049e`). The later local-main reconciliation
retains permission/provenance OA-428/429 and moves composer dictation/animation to
OA-432/433. Current ticket identities are in the git history of the removed ticket log.

Merged fetched `origin/main` at `742049e` into `codex/composer-dictation`.
Composer conflict resolutions retain dictation's send lock and prompt status,
the incoming permission picker, pointer attachment entry and drop-target integration.
Both dictation and permission API imports, routes and static segments remain present.

The independent branches reused ticket numbers. Incoming motion records retain
OA-425–OA-427; local dictation, prompt animation and reasoning icon records now use
OA-428–OA-430. Local evidence was recorded separately; upstream evidence remains
under its original numbers. Historical commit titles are unchanged.

The incoming permission screens were added to the shared component audit. The
adoption disclosure now uses the existing Collapsible and Button composition;
its controlled verifier opens that disclosure before checking archived rules.

## Verification

- Frozen dependency install and full workspace build passed.
- Standalone controlled checks passed for dictation, desk motion, permission
  controls, permission adoption, permission sessions, model selection, capability
  catalogue and packaged bot knowledge. These checks use controlled adapters and
  disposable data; they do not establish live provider acceptance.
- Shared component inventory passed for 113 production TSX modules. Whitespace
  and unresolved-conflict checks passed.
- Built-in read-only review against both parents found no actionable integration
  defects in the resolved paths.
- The isolated preview on port 4750 was backed up with SQLite's online backup
  before restart. Backup: `/tmp/openag-dictation-pre-main-KuOLsn/preview.sqlite`.
  After restart, health and exact current built index passed; database integrity,
  bot/room/device counts and dictation configuration match the pre-merge snapshot.
  No permission adoption or grant was performed. Port 4747 was not changed.

Incoming delivered permission help and existing dictation help are packaged by
the workspace build. The bot-knowledge delivery check passed, including controlled
default-agent replacement. This merge adds no new product behavior beyond its
parents, so no additional help topic is needed.

Unit/Jest/Vitest suites were not run under owner policy. Real adapters, live
providers and physical microphone recognition were not rechecked. Motion timing
was not visually requalified during this merge. No deployment or push was made.
