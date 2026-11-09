# Shared skills for OpenAg agents

Status: specification and verification boundary accepted by the owner, 3 November 2026; external publication pending tracker setup. This document specifies desired behavior; it does not claim implementation or live acceptance.

Publication: external issue-tracker destination and triage vocabulary are not configured in project guidance. Run `/setup-matt-pocock-skills` before publishing with `ready-for-agent`. This draft does not change the local ticket queue or authorize implementation, installation or deployment.

## Problem Statement

The owner already maintains reusable skills in a global Agent Skills library. OpenAg only manages separate copies for each agent. The owner cannot select a shared skill for several agents, see where a skill came from, or reliably use its accompanying references and resources through OpenAg.

OpenAg's current format also differs from the portable format: it requires a positive numeric version and uses a limited frontmatter parser. Directory discovery alone would still reject valid external skills. ACP runtimes may independently discover host skills, leaving the owner uncertain which instructions an agent can actually see.

## Solution

OpenAg offers the daemon host's `~/.agents/skills` as an owner-enabled, read-only shared library. The owner reviews the catalogue and selects which skills each agent receives. Existing agent-owned skills remain available, and approved new skills continue to be saved to that agent's own store.

The desk shows source, assignment and availability. Agents receive a bounded index and load the selected skill's instructions and supporting references on demand. The same selection governs API and ACP runtimes. Loading a skill grants no new action permissions.

Domain language: a skill is the reviewed reusable method; a skill package contains its instructions and resources. A skill source supplies packages, the skill catalogue inventories them, and a skill assignment selects a particular shared package for an agent. Discovery, assignment, skill readiness and action approval are separate facts. These terms are defined in the project glossary.

## User Stories

1. As an owner, I want to enable my existing global library, so that I can reuse it without copying every skill.
2. As an owner, I want shared discovery disabled until I enable it, so that host files do not silently become agent instructions.
3. As an owner, I want the desk to explain that the directory belongs to the daemon host, so that I do not confuse it with my phone's filesystem.
4. As an owner, I want to inspect available shared skills before assigning them, so that I can review their purpose and origin.
5. As an owner, I want to assign a shared skill to one or more agents, so that each agent receives the methods it needs.
6. As an owner, I want newly discovered shared skills to start unassigned, so that adding files does not silently expand agent context.
7. As an owner, I want to remove an assignment, so that later loads and turns no longer offer that skill to that agent.
8. As an owner, I want to disable the shared source, so that shared discovery and subsequent loads stop without deleting files.
9. As an owner, I want existing agent-owned skills preserved, so that this feature does not disrupt established workflows.
10. As an owner, I want source information beside each skill, so that I can distinguish shared and agent-owned instructions.
11. As an owner, I want duplicate names shown separately, so that I can choose the intended source without hidden replacement.
12. As an owner, I want unavailable or invalid skills explained, so that I can correct the library without guessing.
13. As an owner, I want ordinary portable skills accepted without OpenAg-specific version fields, so that existing packages work.
14. As an owner, I want assignments to survive daemon restarts, so that configuration remains consistent.
15. As an owner, I want API and ACP agents to receive the same selected catalogue, so that changing runtime does not change skill access unexpectedly.
16. As an owner, I want runtime-native skill discovery controlled or explicitly reported as unsupported, so that assignment controls are meaningful.
17. As an agent, I want a concise index of my available skills, so that I can choose a relevant method without loading every body.
18. As an agent, I want a bounded way to find assigned skills omitted from the prompt index, so that large libraries remain usable.
19. As an agent, I want to load a skill by an unambiguous identity, so that duplicate names do not select the wrong instructions.
20. As an agent, I want to read a selected skill's relative references, so that its workflow is complete.
21. As an agent, I want to identify accompanying scripts and assets, so that I can use them through suitable existing tools when permitted.
22. As an owner, I want unsupported resources and missing dependencies reported, so that discovery is not mistaken for readiness.
23. As an owner, I want shared skills protected from OpenAg writes, so that agent learning does not alter my global library.
24. As an owner, I want newly authored skills saved to the agent's own store, so that shared and personal ownership remain clear.
25. As an owner, I want reflection proposals to retain their approval boundary, so that shared discovery cannot silently change agent knowledge.
26. As an owner, I want script execution and external actions to retain normal approvals, so that a skill cannot grant itself authority.
27. As an owner, I want unattended restrictions preserved, so that scheduled activity cannot gain new powers through a skill.
28. As an owner, I want unsafe paths and out-of-package resources refused, so that skill loading does not expose unrelated host files.
29. As an owner, I want skill descriptions, bodies and returned references redacted, so that existing secret protections remain effective.
30. As an owner, I want delivered help to explain shared skills and their limits, so that the default bot can accurately guide me.

## Implementation Decisions

- Extend the existing skill service, gateway, first-party skill tools and desk skills panel. Use one daemon-owned catalogue for both runtimes; do not build a separate skill engine for each model provider.
- Add one optional shared source: the daemon user's global `.agents/skills` directory. Configuration comes from owner-authorized actions. Do not accept arbitrary host paths from agents or ordinary device requests. Catalogue reads have no configuration effects.
- Keep shared sources disabled on upgrade. Preserve existing agent-owned skills and legacy slug-based loads where unambiguous. Shared skills require explicit per-agent assignment; existing assignments persist in daemon-owned storage.
- Give catalogue entries a stable, source-qualified identity based on the source and skill location. Names are display and discovery metadata, not unique identifiers. Never merge same-name instructions or silently replace a selected source with another. A missing assignment stays unavailable rather than rebinding by name.
- An assignment selects a package, not an immutable revision. Changes made outside OpenAg can change later loaded contents without a new assignment; report current validation and availability rather than claiming that assignment approves every future revision. Revision pinning and per-change review are outside this feature. Existing instructions already supplied to a turn remain context data, not new action authority.
- Parse portable YAML frontmatter and retain the skill package root. Accept the standard required name and description without a required OpenAg version; preserve compatibility with existing OpenAg skills and keep managed revision bookkeeping separate. Unsupported extension metadata must not acquire authority.
- Distinguish discovery, assignment and readiness. A discovered package can still be invalid, unavailable, unsupported or unassigned. Do not claim dependency readiness without checking it; do not install dependencies automatically.
- Keep a bounded metadata index. Provide bounded catalogue lookup for the requesting agent's assigned skills when the index is truncated. Every load rechecks source enablement and assignment; request arguments cannot select another agent's authority.
- Extend skill loading with a source-qualified identifier and bounded relative-resource access. Text references use the same redaction and untrusted-content treatment as instructions. Other assets must be identified with their supported access route or an explicit limitation; discovery alone must not imply the runtime can consume arbitrary media.
- Use canonical package containment, file-type checks and size limits for resources. Refuse traversal and escapes. Preserve strict no-symlink rules for managed writes. For external discovery, resolve skill-directory links only through an owner-trusted source policy; reject broken links and resource links escaping the resolved package. Supporting such links grants no new write authority.
- OpenAg's save, reflection and data-history paths must never modify the shared source or target it through an alias. New skills remain agent-owned and use current redaction, atomic writes, revision history and policy checks. Shared read-only status describes these managed paths; it is not an OS sandbox against independently authorized shell commands.
- Persist source enablement and per-agent assignments in daemon-owned storage. Expose authenticated catalogue and resource reads plus owner-only configuration changes through the existing gateway. Register any new top-level route segment and audit configuration changes without recording private contents or host paths unnecessarily. Exact route names and migration layout belong to implementation design.
- Keep API and ACP context delivery consistent. Investigate native CLI discovery for supported adapter versions and suppress or isolate competing discovery using supported controls. If a runtime cannot enforce the selected catalogue, report that limitation and do not advertise assignment as an exclusive access boundary. Native discovery parity is an acceptance requirement, not an assumption based on inherited HOME.
- Configuration changes affect subsequent catalogue reads and turns; they cannot erase instructions already supplied to an active turn. Refresh or invalidate cached runtime context before claiming a new selection is in effect. Runtime restart survival and mid-turn behavior must be visible and documented.
- Skill instructions and metadata never override operating rules, the central action policy, locked tool classes or unattended restrictions. Scripts execute only through existing authorized tools; do not add automatic execution on discovery or loading.
- Update the release handbook and authoritative skills guide with setup, desk location, permissions, source identities, readiness and limits. Verify packaged delivery to the configured default bot, including an existing installation. This spec and the research note are design inputs, not shipped bot knowledge.

## Testing Decisions

- Owner-confirmed primary boundary: an owner enables a temporary shared source through the normal gateway, assigns one package to agent A, and uses the normal agent tool path to discover it, load its instructions and read a reference. Agent B cannot load it. An action described by that skill still requires the existing policy decision.
- Use an isolated daemon, temporary data and synthetic packages. Do not read or modify the owner's real shared library for acceptance. Reuse the controlled gateway/runtime verification style already used for connector isolation, capabilities and hosted context; prefer existing dependency injection to a new production abstraction.
- Exercise externally visible behavior of the catalogue, assignment persistence, skill tools, runtime delivery and desk. Do not test parser implementation details, private helper calls or snapshot formatting.
- Extend the same flow with duplicate names, a portable file without version, multiline YAML, a missing resource, an out-of-package path, linked folders, malformed metadata, truncation, a disabled source and restart. Each refusal must preserve existing files and avoid fallback to another identity.
- Stress-test the domain boundaries: two packages named weekly-review remain distinct; deleting an assigned package never selects its same-name neighbour; editing a shared package changes later validated loads without changing its assignment; removing an assignment blocks new loads while acknowledging instructions already delivered to an active turn; a package can be assigned but not ready because a reference or required dependency is missing. None of these states changes action permissions.
- Check managed writes with byte-level before/after evidence that shared packages remain unchanged, including saves, edited approvals and reflection. Verify legacy agent-owned skills still load and version normally.
- Verify API and ACP delivery using controlled transports, followed by a narrow real-adapter check where native discovery cannot otherwise be established. Confirm stale sessions do not retain an apparently current catalogue. Model invocation and any unavailable runtime evidence must be reported separately.
- Review the actual desk flow for source labels, assignments, duplicates and unavailable states. Verify limited-device refusal for configuration changes and preserve owner access rules.
- Verify the ordinary action approval and unattended-denial paths with synthetic operations, without sending messages or performing external effects. Skill loading must not change either outcome.
- Run applicable builds, controlled integration/self-check scripts and delivered bot-knowledge verification during implementation. Never run unit tests or Jest, including through scripts or hooks. No implementation verification is claimed by drafting this spec.

## Out of Scope

- Marketplaces, downloads, remote registries and automatic installation or dependency setup.
- Additional project or arbitrary external discovery roots in this first feature.
- Editing, deleting, synchronizing or publishing shared packages from OpenAg.
- A visual skill authoring tool, automatic assignment or automatic skill execution.
- Revision-pinned shared assignments and a new approval workflow for every external package edit.
- A generic plugin framework, a new execution engine or replacing existing memory/reflection.
- OS-level isolation from all host files, broad shell-policy changes or treating assignments as a filesystem sandbox.
- Historical transcript ingestion, live library migration, deployment or changes to the local build queue.

## Further Notes

The accepted direction comes from the owner's shared-skills discussion and the [OSS comparison](../notes/skills-oss-research.md). The [Agent Skills specification](https://agentskills.io/specification) defines the package format, not a universal directory-discovery policy. Current upstream documentation does not prove native discovery behavior in an installed ACP adapter.

Use the domain definitions of agent, owner, skill, approval, context data and operating rules. A skill describes a method; it does not create Work, define a standing responsibility or authorize actions. The accepted decision separating responsibilities from Work remains unchanged.

The owner confirmed the verification boundary above. Before publication, configure the project issue tracker and triage vocabulary through `/setup-matt-pocock-skills`. Then publish with `ready-for-agent`. Do not claim an issue number or tracker-ready status before publication. Implementation remains subject to the project's local queue and working rules.
