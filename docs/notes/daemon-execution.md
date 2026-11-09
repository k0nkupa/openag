# Daemon-owned execution checkpoint

Status: historical OA-398 implementation checkpoint, 4 November 2026. This proves the execution interface. It does not ship the permission picker, persisted presets, migration or new automatic-action receipts. The normal daemon still uses the existing policy. OA-399 through OA-403 deliver the replacement.

## Enforced boundary

`apps/daemon/src/execution.ts` owns local commands. API providers and Ollama reach it through the runner's normal tool gate. Claude and Codex reach the same gate through OpenAg's scoped MCP server. The fixture selects the filesystem boundary from trusted code; model arguments cannot select it.

On macOS, Read Only denies filesystem writes except `/dev/null`. Workspace Write allows the canonical workspace, explicit canonical additional roots and a private per-command temporary directory. Native configuration directories and Git metadata (including Git pointer files and shared worktree targets) remain protected in confined modes, because they can introduce execution paths outside the daemon. Full access runs without the filesystem sandbox. Workspace Write inspects writable roots and their ancestors for Git metadata without following directory symlinks; more than 20,000 directories or an unreadable/invalid metadata pointer makes that invocation unavailable. Confined modes are unavailable on other operating systems; they never fall back to Full access.

The Seatbelt profile follows DSH's pinned macOS filesystem profile: allow default, deny writes, then allow the selected roots. It does not isolate network access, process visibility or host-readable files. Read Only is not read-only access to remote accounts. Full access may read credentials accessible to the host identity. Child environment values are restricted; output is untrusted, bounded and redacted. A stream that overflows is omitted rather than exposing a secret cut at the output boundary. The existing hosted runtime stops on truncated output without replay. Timeout/cancellation signals the process group and settles within a further second even if a detached child retains an output pipe. Group cleanup is best effort: a child that creates another process group can survive. Its filesystem sandbox remains inherited, but process lifetime is not isolated. Interrupted command effects require inspection and must not be described as a proven failure or retried automatically.

Commands execute with `/bin/sh -c`, using POSIX shell syntax. The tool schema and description state this explicitly; Bash/zsh process substitution and arrays require an explicitly selected interpreter. The daemon-owned boundary remains in force for that subprocess tree.

## ACP controls

The explicit internal `daemonExecution` option selects the checkpoint path. It is not accepted from bot configuration or an HTTP request, and the production entry point does not enable it yet.

Claude starts with no built-in tools, no settings sources and strict MCP configuration. Codex keeps its read-only native mode, disables native shell, hooks and alternate execution/discovery features, and rejects native permission requests. Exact own-server MCP transport requests may proceed; the actual tool still goes through the daemon gate.

Codex reads inherited MCP declarations through a bounded, passive configuration request. Only names and transport kinds are retained. Disabled transport stubs are applied at startup and per session. A small pinned ACP package patch preserves these exclusions when the adapter adds OpenAg's MCP server; the upstream adapter otherwise replaces the session MCP map. Original profile configuration and authentication are not modified or copied. Failed configuration discovery prevents startup. This patch and the measured native controls require renewed compatibility checks on adapter upgrades.

## Verification scope

`node scripts/verify-daemon-execution.mjs --real` uses a temporary database, real gateway, runner, policy gate, scoped MCP endpoint and both installed subscription adapters. Each adapter must make four actual daemon calls in one reused session: workspace write succeeds, outside write fails, Read Only write fails, Full access outside write succeeds. A fifth native-only request must produce no file effect or daemon fallback. A harmless inherited MCP fixture must never start. Checks inspect actual tool outcomes and target files; model success text is not evidence. At OA-398 the legacy fixture explicitly granted act-local Auto; it did not prove preset approval policy. OA-399 subsequently upgraded these scripts to persisted gateway selection and independent automatic receipts; see [permission sessions](permission-sessions.md).

`node scripts/verify-permission-providers.mjs` exercises actual provider runtimes and SDK request formats with controlled HTTP transports. It covers Ollama, DeepSeek, OpenAI, Anthropic, Google, OpenRouter, Groq, Nebius, xAI, Alibaba, Mistral, Cerebras, DeepInfra and Perplexity. All use the same real gate and subprocess boundary. Additional Ollama checks cover symlink and descendant escapes, timeout, protected native configuration, split UTF-8 secret redaction and overflowing output. Provider follow-up requests must contain the actual nested untrusted tool result. This is controlled integration evidence, not live hosted API acceptance.

Historical native-preset and hook failures remain documented in [the adapter checkpoint](permission-modes-adapter-checkpoint.md). They establish why native modes alone cannot implement this replacement. Current sanitized execution evidence is recorded in [daemon-execution.json](permission-modes/daemon-execution.json).

Knowledge impact: the public tool catalogue and delivered handbook remain unchanged because this slice is internal and not enabled for installed bots. Later campaign slices must update and verify delivered guidance when the replacement becomes available. No deployment or live account write is part of this checkpoint.

## Review and checks

Local Standards/Spec review and a separate source-only `codex review --uncommitted` covered this checkpoint. Review found unbounded output-pipe waits after process-group escape, incomplete nested metadata protection, and Git pointer targets. The implementation now bounds settlement, reports interruption honestly, and protects resolved Git metadata; focused controlled journeys cover those cases. The final built-in review reported no remaining substantive defects within OA-398.

Frozen dependency installation (scripts disabled), workspace build (relay dry-run only), daemon typecheck, standalone ACP continuity/tool-identity, capability catalogue and packaged bot-knowledge checks passed. No unit/Jest/Vitest runner was used. Public preset approval semantics, automatic receipts, owner picker and migration are not claimed by these checks.

## Local shell search

The daemon ships a pinned `@vscode/ripgrep` platform binary. Its directory is prepended to the command minimal PATH, including under host confinement; no host/Homebrew installation is required. Search the narrowest known paths and discover file names before scanning contents across repositories. Commands retain existing timeouts, permissions and the unknown-effect inspection guard. A timed-out search is never automatically replayed or silently cleared.

## Bounded inspection and conflict scope

Use `read_file`, `list_files` and `search_files` for host inspection. Relative paths use the private workspace; absolute paths follow existing host-read authority (filesystem modes confine writes, not reads). These operations execute no shell. Reads accept regular UTF-8 files up to 64 KiB; listing is bounded to 200 immediate entries. Literal search skips linked/special/binary/oversized files, hidden directories and node_modules, visits at most 1000 entries and returns at most 100 matching lines within a character/time budget. A missing directory returns `found:false`; missing file reads fail. Results are redacted untrusted data. Cancellation/timeouts fail the read invocation without uncertain mutation or a write fence. These tools do not import packages or execute package scripts.

Receipt outcomes retain history. Conflict scope is supplied by daemon executors and checked at authorization and dispatch. `write_file` uses its canonical private-workspace target and refuses escaping paths, linked targets and changed scope; managed skill writes include their package directory and shared serialized Git history. Reads never conflict. Path scopes conflict on equality or ancestor overlap across all chats/bots, conservatively ignoring ASCII case on every filesystem. Non-ASCII path identities remain opaque rather than guessing filesystem collation. Search redacts whole-file content before extracting matches; line is null when multiline redaction prevents an accurate source line number. Unrecognized tools and historical writes without scope are opaque and conflict conservatively with any write. Shell text, chat identity and provider hints cannot narrow scope. A known Failed invocation is not proof of absent partial effects and never authorizes automatic retry.

Owner inspection preserves Unknown, invalidates only overlapping pending proposals, and makes older overlapping proposals fail dispatch. Unrelated scoped approvals remain valid. Recovery records an interrupted bounded read as Failed and an unfinished started write as Unknown; not-started operations remain Not run. Old rows retain their outcomes and evidence; absent write scope stays opaque. No age-based clearing, bot self-inspection, provider retry framework or owner risk override is introduced. Native execution remains disabled in both adapters.
