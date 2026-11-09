# OA-364 connector migration isolation

Fix for the review of OA-365 (formerly OA-363) against main. Local source and controlled verification only; no deployment, live account, device or credential changes.

The new regression script first reproduced a healthy legacy Google connection failing key import solely because the optional Composio record was damaged. The key resolver now requires the calling connector's identity. A readable saved record validates the original key without depending on another connector's broken file. When the caller has no saved record, legacy peer validation remains so Composio-first startup cannot save an incorrect key before Google can reject it. Global missing-original checks, stored-key conflict refusal, private-file checks and ciphertext formats are unchanged.

Passed checks:

- Workspace build/typecheck.
- Standalone connector-isolation check: both Google/Composio directions with damaged, unsafe and symlinked peers; the unhealthy connector stays unavailable and all record/target bytes stay unchanged. An additional scenario verifies wrong-key rejection before publication with no caller record, then successful original-key retry.
- Managed-onboarding, Composio OAuth/MCP/runner and Google connector acceptance against temporary state and controlled transports.
- Bot-knowledge delivery through API, Ollama, cached ACP/MCP and default-bot configurations, including an assertion for the new isolation explanation.
- JavaScript syntax and git whitespace checks.
- Focused follow-ups from the original Standards and Spec reviewers: both clear, no additional actionable defects.

Built-in `codex review --uncommitted`: no actionable defects. Its daemon typecheck, script syntax/whitespace checks and standalone isolation check passed. Only ticket/evidence documentation changed after this review. No unit/Jest/Vitest runner was used. Provider acceptance and physical-device sign-in were not checked.

Knowledge: authoritative credential recovery in docs/composio.md and its summary in docs/help/computer-connectors.md were updated together. The knowledge verifier checks both packaged content and actual controlled bot delivery. The existing UI and callback behavior did not change.
