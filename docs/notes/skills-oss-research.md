# Shared skills in other open-source agents

Researched 3 November 2026. Scope: current first-party documentation and selected source files for Codex, OpenCode, Pi, Hermes and OpenClaw. This is research for discussion, not an implementation plan or runtime acceptance. No installation, model turn, test runner, live configuration or existing skill was changed.

## Main finding

`~/.agents/skills` is a shared discovery convention supported by several agents. It is not the complete Agent Skills specification, and implementations differ on discovery, collisions, trust and writes. OpenAg can reuse that library, but merely adding another directory scan would not provide compatible packages or consistent behaviour across runtimes. The Agent Skills format defines a directory with YAML-frontmatter `SKILL.md` and optional supporting resources; it does not mandate a global discovery path. [Specification](https://agentskills.io/specification).

## Comparison

| Project | Global and project discovery | Collisions and control | Relevant lesson for OpenAg |
| --- | --- | --- | --- |
| Codex | User `$HOME/.agents/skills`; repository `.agents/skills` directories from working directory to repository root; admin and bundled sources also exist | Same-name skills are not merged; both can appear in selectors. Path/name configuration can disable skills | Preserve source identity instead of assuming a name uniquely identifies a skill |
| OpenCode | Native global/project directories plus both `.agents/skills` and `.claude/skills` compatibility directories | Per-skill `allow`/`ask`/`deny`, including agent overrides. Docs advise unique names but do not establish a reliable collision precedence | Shared discovery and per-agent exposure can be separate controls |
| Pi | Supports global/project `.agents/skills`, its own resource locations, and explicit paths/packages | First discovered name wins with a diagnostic; duplicate real files are deduplicated | Report winners and hidden copies; retain resource base paths |
| Hermes | Profile-owned `~/.hermes/skills`; shared `.agents` root is explicitly configured through `skills.external_dirs`; trusted project skills supported | Project → profile-local → creation directory → external. Intra-root name ambiguity requires an exact relative path | Configured shared sources can coexist with an application-owned creation store |
| OpenClaw | Documents workspace, project `.agents`, personal `.agents`, state-managed, workshop, bundled and extra sources | Workspace > project `.agents` > personal `.agents` > managed > workshop > bundled > extras; per-agent allowlists separately restrict visibility | Separate storage ownership, environment eligibility and agent exposure |

The table is supported by the detailed primary references below. OpenClaw's entry is documentation evidence; its loader implementation was not independently traced. Latest upstream behaviour does not establish what an installed version or OpenAg ACP adapter does.

## Codex

Codex documents user-global and repository discovery, symlink support, explicit `$skill` invocation and implicit description matching. It puts metadata and paths into context, then reads full instructions on demand. It supports scripts, references, assets and `agents/openai.yaml`; the latter can disable implicit invocation. Name collisions can remain visible together rather than silently replacing one another. Local configuration supports disable selectors by path or name. These are current product-doc claims, not proof that OpenAg's installed adapter exposes the identical catalogue. [Official skills documentation](https://developers.openai.com/codex/skills/), [open-source CLI repository](https://github.com/openai/codex).

## OpenCode

OpenCode scans `.opencode/skills`, `.claude/skills` and `.agents/skills` in project scope, and corresponding global roots (`~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`). Project discovery walks toward the Git worktree boundary. Its `skill` tool advertises name/description and loads instructions on demand. Pattern permissions can hide/refuse a skill or require approval before loading it; agents can override these defaults. Unknown frontmatter fields are ignored. The documentation says names should be unique across roots; this research does not infer collision precedence from its presentation order. [Official skills documentation](https://opencode.ai/docs/skills/), [source repository](https://github.com/anomalyco/opencode).

## Pi

Pi documents both `.agents` roots, recursive skill discovery, `/skill:name` invocation and resource paths resolved relative to the skill directory. Its loader carries `filePath`, `baseDir` and source information. `addSkills` preserves the first name and emits a collision diagnostic containing winning and losing paths; identical resolved files are skipped. Instructions and bundled resources load when needed. Project skills can direct scripts and file changes, so the docs advise reviewing them before project trust. The low-level loader's default order is not sufficient to infer the complete application resource order; the resource layer also supplies configured paths. [Skills guide, pinned documentation](https://github.com/earendil-works/pi/blob/25cc5c7bf4cbc76b2e134c729eb8d57d521ed749/packages/coding-agent/docs/skills.md), [loader source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts).

## Hermes

Hermes keeps its primary library under the profile's `skills/`, with explicit external roots such as `~/.agents/skills`. Discovery and loading share precedence, and shadowed copies are reported. Project skills require a trust decision; non-interactive surfaces inherit it. External roots are **not read-only**: agent updates modify the winning skill in place when writable. Filesystem permissions are required for that boundary. New skills normally go to the profile store, with an optional creation directory. `skill_view(name, path)` loads supporting files progressively. This is close to OpenAg's reusable-workflow model, but its mutable external-root behaviour should be a deliberate choice rather than an accidental consequence of discovery. [Skills system, pinned documentation](https://github.com/NousResearch/hermes-agent/blob/91c51e04f457f0e5f105045e0700177199104bae/website/docs/user-guide/features/skills.md#external-skill-directories).

## OpenClaw

OpenClaw documents per-agent workspace skills and a state-owned shared library. Its personal `~/.agents/skills` source is excluded when using a non-default state directory. Allowlisting governs visibility separately from source precedence; an empty per-agent list exposes none. Requirements such as binaries, OS and environment determine readiness. Its docs explicitly distinguish inventory, readiness and visibility, and warn that skill allowlists are not a shell authorization boundary. It also documents revision-pinned managed bundles for shared gateways, including supporting files. These advanced library mechanisms are informative, but not necessary for a first OpenAg shared-directory feature. [Official skills documentation](https://docs.openclaw.ai/tools/skills), [source repository](https://github.com/openclaw/openclaw).

## Baseline OpenAg gaps before OA-384

These findings describe the pre-implementation checkout inspected during this research, not the current implementation or running installation. See [shared-skills acceptance](shared-skills-acceptance.md) for subsequent source changes and verification:

- **Format:** `parseSkill` requires a positive numeric top-level `version`. It splits frontmatter by line rather than parsing full YAML and truncates descriptions to 200 characters. Standard skills need only `name` and `description`, support YAML forms, and permit descriptions up to 1,024 characters. A valid external skill without OpenAg's version is ignored. [OpenAg parser](../../apps/daemon/src/skills.ts), [standard format](https://agentskills.io/specification).
- **Package resources:** `skill_load` returns metadata and body but no skill resource locator. OpenAg's managed save/history path covers `SKILL.md`; there is no corresponding managed bundle/resource loader for scripts, references or assets. Merely loading the body does not prove a bot can resolve and safely use its relative files. [Skill tools](../../apps/daemon/src/tools/skills.ts), [data Git](../../apps/daemon/src/datagit.ts), [skills guide](skills.md).
- **Discovery:** the runner builds the index from the selected bot's store. The index is capped at 40 entries/2,000 characters. Shared-library discovery, per-bot assignment and collision reporting are not implemented in that path. [Runner](../../apps/daemon/src/runtimes/runner.ts), [skill index](../../apps/daemon/src/skills.ts).
- **Path policy:** managed OpenAg skills reject symlinks, whereas Codex explicitly follows symlinked skill folders. Supporting external libraries requires an explicit source/path trust rule; relaxing the managed write path is a separate decision. [OpenAg skills guide](skills.md), [Codex docs](https://developers.openai.com/codex/skills/).
- **Two discovery owners:** OpenAg launches its ACP adapter with inherited environment after removing selected secrets. `HOME` and `CODEX_CONFIG` are not removed in the inspected code, and there is no skill-specific suppression there. The lockfile resolves `@agentclientprotocol/codex-acp` to `2.3.0` (the package range is `^2.3.0`). This establishes potential independent native discovery, not its actual catalogue or behaviour. API bots use OpenAg's own prompt/tool path. [ACP launcher](../../apps/daemon/src/runtimes/acp.ts), [package declaration](../../apps/daemon/package.json), [lockfile](../../pnpm-lock.yaml), [runner](../../apps/daemon/src/runtimes/runner.ts).

## Recommendation for discussion

The smallest useful direction is one daemon-owned catalogue with explicit sources, while preserving the existing per-bot creation store. This is a recommendation, not existing behaviour:

1. Recognize the portable Agent Skills format before adding discovery roots. Keep OpenAg revision bookkeeping separate from required external frontmatter.
2. Offer `~/.agents/skills` as an owner-enabled, read-only external source. The daemon host's home is the relevant home, not the phone/browser user's filesystem. Keep new bot-authored skills in the existing approved per-bot store.
3. Give each catalogue entry a source and stable path/identity. Let the owner select which shared skills a bot sees. Show duplicates and their origins; do not silently merge instructions.
4. Deliver the selected catalogue consistently to API and ACP bots, including a bounded way to load relative reference files. Resolve who owns native CLI discovery before claiming that the catalogue is exclusive.
5. Keep skill access and action authority separate. A skill's `allowed-tools` metadata must not override OpenAg's policy gate or unattended restrictions. Script execution needs the ordinary execution permission and environment controls.

A managed marketplace, automatic dependency installation and revisioned team library can wait. They are larger product decisions than reusing an existing local skill folder.

## Limits

This comparison is a focused documentation/source study, not an exhaustive security audit or runtime compatibility check. No external agent was launched and no skill package was installed or executed. Current upstream documentation may describe behaviour newer than locally installed versions. OpenCode's collision precedence and OpenAg's actual native ACP skill catalogue remain unverified. This research note is not delivered bot help and makes no claim that existing bots can read it.
