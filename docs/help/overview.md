# OpenAg overview

OpenAg is a local agent workspace. One daemon owns the database. The web desk and phones connect to it; they do not maintain separate brains or database copies.

The default bot is the main assistant and the fallback bot for heartbeat and reflection when those features do not select another bot. It is not an owner account and cannot bypass permissions. A room lead is a separate role used for message routing and delegation.

Use each agent’s conversation side panel for bot settings, the conversation itself for approvals and questions, Work for tracked activity, Automations for schedules/triggers, and App library or Connectors for integrations. Settings contains Models, Proactive, Devices and Server. Labels describe this release, not proof that your installation is configured.

Ask for another help topic for details. Use openag_status for the limited current-state fields it exposes. If a fact cannot be checked, say it is unknown. A configured feature, a successful tool call, a deployed change and a user-visible result are different evidence.

Use openag_capabilities for current search, computer and notification availability, safe next steps and this bot's permission modes. It includes unavailable tools so you can explain what is missing. A tool being offered or configured does not grant execution authority or prove credentials work.

A new Mac installs with one command from the repository: `pnpm onboard`. It checks Node 22+ and pnpm, runs install and build, detects model sources without launching agents or calling providers (Claude Code and Codex adapters and CLIs, provider key names, Ollama models), optionally installs the always-on launchd service (`--service`, `--no-service`, `--lan`), starts the daemon, waits for health and runs the same `pnpm desk:open` flow below. `--dry-run` prints the plan and changes nothing; `--yes` accepts defaults; `--ollama-model <name>` seeds an Ollama agent. It is safe to re-run and never overwrites existing data or credentials. It cannot see whether Claude Code or Codex is signed in; if Bot cannot answer, the user signs in to `claude` or `codex`, sets a provider key in the daemon environment, or adds an Ollama model. Setup does not touch the owner credential and grants no new permissions.

OpenAg manages its owner credential. For first sign-in or cleared-browser recovery, the user runs `pnpm desk:open` from this repository on the daemon computer as its OS user, then confirms the browser name and Full access. This needs a running daemon and matching OPENAG_DATA. Other devices pair from Settings, Devices; Limited is the default. Do not ask users to paste or remember an owner token for the normal flow. Never offer host recovery as a bot action or treat localhost as owner authority. See the authoritative [owner access and recovery](../notes/owner-access.md) for migration, expiry and limits. Existing token-based installations remain compatible; connector encryption keys are separate.

Devices has its own Settings page at `#/settings/devices`. The current device appears first; active access is separate from collapsed revoked history. Pair device opens a dialog and creates a code only after confirmation. Manage opens access settings and a separate removal confirmation, including any devices added by that device. Codes expire after five minutes; closing and reopening the dialog reuses an unexpired code. A loopback address cannot provide a phone QR route: use a reachable LAN/Tailscale desk address and enter the code. See [Devices](../notes/devices.md) for the authoritative UI and limits. Server settings and WebRTC remain on the Server page.

## Settings layout

Automations is a Workspace destination, with one sidebar/search entry and Workspace breadcrumb. Settings navigation contains Profile, Connectors, Models, Proactive, Devices and Server.

The Settings destinations use the shared shadcn interface. Server starts with a status summary and Overview, Operations, Connection and Appearance tabs. Overview lists incomplete required checks first; Completed checks and Optional setup expand on request. Operations contains backups, turn limits and diagnostics. Connection contains network routes, direct join and the Devices link. Appearance changes this browser only. See [Settings layout](../notes/settings-polish.md).

Keyboard navigation starts with Skip to content in both desk layouts. It moves focus to the current page without changing its address. Important Proactive tabs, automation edits/run history and conversation side-panel sections have restorable links. Context changes keep mounted drafts; leaving an editor still uses the discard/pending-operation guard.

Host operators can use the [documentation index](../README.md) and [local deployment runbook](../local-deployment.md). Existing service updates preserve the full environment and credentials, take a verified backup and check the running release. A restart alone does not deploy a newly built checkout. These are operator procedures, not bot-granted deployment authority.

## Your name and avatar

Open **Settings → Profile** (`#/settings/profile`) to edit your display name and profile image. Chat hides sender names/images; accessible sender labels use your name. Choose **Upload image**, select a JPG, PNG or WebP up to **5 MiB**, then drag and zoom in **Adjust your image**. Arrow buttons also move the image. Choose **Use image**, then **Save profile**. **Remove image** restores initials after saving. Cancel leaves the saved profile unchanged. Full-access devices can save; Limited devices can view.

The browser crops to 256 × 256 pixels and prepares a JPEG capped at **64 KiB**; the original image is not uploaded. Images above 20 megapixels are refused. User avatars are uploaded images; the character picker is for agents. The profile belongs to this OpenAg server and is shared across its paired devices. It updates accessible message labels and user activity; recorded message actors, device names and access permissions stay unchanged. The default name is “You”. Older bot-style user avatars display initials until replaced with an image. The profile is a display preference, not a separate user account or an instruction to agents. See [Profile behavior](../notes/profile.md).
