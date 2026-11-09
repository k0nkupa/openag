# Shared skills acceptance (OA-389)

3 November 2026. Local source and controlled acceptance only. No deployment, production configuration, real library edits, provider consent or external issue publication was performed.

## Delivered behavior

The optional daemon-host shared source starts disabled. Owner/Full devices can enable it, inspect portable packages and assign source-qualified identities to agents. New packages remain unassigned. Agent-owned saves and reflection retain their existing approved, redacted and versioned write path. Shared files are never edited by managed skill writes.

Agents receive bounded metadata and load instructions/references through the same policy gate. Normal agent reads inspect only their managed and assigned packages; full shared discovery occurs only for owner inventory requests. Resource reads require bounded regular non-hidden inventory membership and canonical containment. Duplicate names stay distinct, missing identities do not rebind, and external edits are revalidated on later loads.

## Evidence

- `pnpm install --frozen-lockfile` completed. Added explicit daemon `yaml@2.9.1`, already present transitively, using pnpm. Installer reported ignored esbuild/workerd lifecycle scripts; no unit runner was invoked.
- `pnpm -r build` passed, including the signin relay's configured dry-run build. The final workspace build also passed after backend review fixes; the desk build passed again after the final readback fix. The existing desk chunk-size warning remains.
- `node scripts/verify-shared-skills.mjs` passed four controlled integration groups: owner/Full versus Limited access, portable YAML and distinct identities; real API runtime and controlled cached ACP/MCP loading; approval/edit/reflection preservation and byte-identical shared files; external edits, missing packages, persistence, directory links, bounded lookup, disabling and redaction. The changed memory-skills handbook topic reached the configured default agent through both API and ACP/MCP tool paths. A new SQLite connection verified persisted assignment configuration; this is not a service-restart claim.
- `node scripts/verify-shared-skills-desk.mjs` passed actual SkillsPanel + actual desk API + temporary real gateway interaction: source enablement, package preview, assignment readback, agent switching, Limited controls, disable and uncertain-write lock/readback. This is DOM integration, not pixel/layout evidence.
- `node scripts/verify-capabilities.mjs` passed capability/gate acceptance and the included four-group packaged bot-knowledge verification. `node scripts/verify-acp-continuity.mjs` passed eight controlled groups covering both adapter profiles, pauses, restart/context continuity, isolation and failure paths.
- All three new standalone scripts passed `node --check`; `git diff --check` passed.

## Native adapter checkpoint

A synthetic global package was visible in the installed Codex's outgoing model request both with and without `features.skip_host_skill_discovery`. That flag alone was rejected as an isolation mechanism.

For the installed Codex CLI 0.164.0 / codex-acp 2.3.0, explicit `skills.include_instructions:false`, `skills.bundled.enabled:false` and `features.skill_search:false` removed the native package metadata and native skill-search tools from the inspected request. Claude ACP 0.97.0 / its installed SDK exposes an empty skills allowlist, which also suppressed native package metadata and the Skill tool.

`node scripts/verify-native-skill-discovery.mjs` passed both real adapter checks with temporary homes, synthetic credentials and loopback model transports. It inspected actual outgoing requests containing neither synthetic global/project skill metadata nor native skill tools. No real provider response or model quality was measured; prompts were closed after request inspection. Temporary cleanup uses bounded asynchronous retries because the Claude child can finish filesystem cleanup after the adapter exits. Initial cleanup failures were fixed and the final command exited successfully.

These controls restrict native catalogues, not independent Read/shell access. Adapter upgrades need fresh verification.

## Regression and review findings

A standalone regression failed when an older managed skill used unquoted metadata such as a colon-bearing name and a boolean-looking description. A further regression showed valid YAML could also silently truncate literal hash characters and discard numeric trigger text. Managed reading/writing therefore retain the original literal line format unchanged, while shared package parsing uses YAML. Both regressions pass.

Independent Standards and Spec reviews found issues with secret-bearing resource names, missing authenticated gateway resource reads, a generic-settings assignment bypass, full shared scans during normal turns, and uninventoried resource access. All were fixed and focused reviewer follow-ups found no remaining substantive issues. The first built-in review then found a blocking FIFO read, escaped-YAML secret reconstruction and inherited assignment-key access. Reads now reject non-regular files before a nonblocking open and validate the opened descriptor; decoded metadata is redacted again; assignment keys are prefixed and read through own-property checks. Controlled regressions include a bounded FIFO subprocess, escaped metadata and gateway/runner use by constructor, toString and __proto__ agents. Both independent reviewers cleared these remediations. Registered-secret filenames are omitted/refused; generic library replacement is blocked; enumeration is capped while reading; agent reads avoid unrelated shared packages; resources must belong to the current bounded inventory.

A later built-in review reproduced a successful assignment save followed by failed readback, which left stale selections editable. Refresh failures now set the uncertainty lock; only a successful full readback clears it. The actual panel/gateway check covers this sequence and passes, and both independent reviewers cleared the fix.

Later review also found unavailable-identity disclosure after late secret registration. Identities are now filtered from reads and settings are redacted; explicit configuration writes sanitize stale private keys/IDs across all agents. Multi-agent assignment and disable/re-enable recovery regressions pass. Existing panel assertions were updated for the current markup without running the unit suite.

Final built-in gate: `codex review --uncommitted` completed with no actionable defects in staged, unstaged or untracked changes against baseline `55636537f8f81cede2d3b53c1e1a35e6d76e9772`. The final review also passed daemon/desk TypeScript, script syntax and whitespace checks. Interrupted attempts were not counted as passes. Independent Standards and Spec follow-ups are clear after the cross-agent cleanup fix.

## Knowledge and limits

Updated product concepts, the authoritative skills guide, the memory-skills handbook topic and manifest, tool descriptions, and aligned AGENTS/CLAUDE guidance. Packaged help delivery was checked for the configured default agent and cached ACP sessions using existing database configuration.

Browser use was initially disabled, then became available. Actual Chrome verification used the built desk at Bots → Knows → Skills against an owned temporary gateway/source. Enabling, duplicate package preview, assignment readback and switching to an unassigned Specialist were checked. Gateway readback confirmed Primary had shared:weekly-review and Specialist had no assignment. The 390px viewport had document width 390px and no horizontal overflow. Desktop and phone screenshots are retained in shared-skills/desktop.jpg and shared-skills/phone.jpg. The viewport override was reset, and the temporary gateway/data were stopped and removed; the installed daemon and real library were untouched. No unit/Jest/Vitest runners ran. Shared assignments remain mutable package selections rather than pinned revisions, and removal cannot erase already-delivered instructions. There is no marketplace, dependency installer or deployment in this change.
