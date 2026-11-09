# OA-362 review corrections — 2 November 2026

Local source verification only. No running service, host credential, live device or provider state was changed.

- Interrupted credential publication: startup removes only UUID staging hard links to the protected credential inode. The regression reproduces the two-link state, verifies identical credential bytes and inode, verifies reuse after restart and conflicting-token refusal, and rejects unrelated hard links and staging symlinks. Publication cleanup tolerates a concurrent resolver having already removed its stage.
- Installer sign-in advice: one shared Bash formatter quotes both repository and selected OPENAG_DATA. The real installer dry-run checks a path containing spaces, quotes, command substitutions and shell metacharacters. The printed command is executed with a harmless pnpm replacement and a deliberately different inherited OPENAG_DATA; the exact selected path wins. Dry-run does not load launchd, seed data or provision credentials.
- The Devices countdown unit fixture now fakes Date and intervals only, leaving dialog timeouts real.

Passed: full workspace build; two credential regression tests; 30 focused desk tests; standalone owner-access, Devices and bot-knowledge acceptance; shell/JavaScript syntax checks; git diff whitespace checks. Independent auth reviewer cleared both fixes and the final cleanup/timer edits. The existing desk bundle-size warning remains.

The owner explicitly requested unit tests for this task, overriding the standing no-unit-runner rule for this verification. `pnpm -r test` was run; the desk failure stopped that recursive command, so the complete daemon and final desk suites were also run separately:

| Suite | Current | Clean main (`10310ff`) |
| --- | --- | --- |
| Daemon | 1,400 passed; 100 failed; 8 unhandled errors | 1,398 passed; 100 failed; 9 unhandled errors |
| Desk | 341 passed; 41 failed; 2 unhandled errors | 341 passed; 41 failed; 2 unhandled errors |

All 100 daemon and 41 desk failing test names match the clean-main baseline. The two added credential tests pass. Remaining failures include existing Apps, MCP, approvals and desk fixture issues; no broad test-maintenance changes were made. The temporary baseline worktree was removed. These suites are not green and are not release acceptance.

Knowledge: the authoritative `docs/notes/owner-access.md` explains both corrections. Existing overview/handbook links package that source; the four bot-knowledge integration groups passed through controlled API/Ollama/cached ACP/MCP/default-bot delivery. No deployment or physical-device acceptance is claimed.
