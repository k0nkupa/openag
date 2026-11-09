# OpenAg desk — design handover

Frozen on 31 October 2026. Start here before OA-319–330 (see [ROADMAP.md](../../../ROADMAP.md) for status).

This package preserves the reviewed Tailwind/shadcn design and the implementation decisions behind it. The runnable reference is isolated from the working desk and daemon. Its data, settings, connections and actions are examples; the approved feature behavior still needs the production tickets. OA-319 now migrates the shared shell into production source in an isolated worktree; see the [integration result](../../notes/desk-shell/README.md). Feature migration beyond that shell, deployment and live-account verification remain open.

## Read in this order

1. [DESIGN.md](DESIGN.md): visual system, accepted changes, responsive behavior and motion.
2. [INTEGRATION.md](INTEGRATION.md): component ownership, dependencies, route/API mapping and backend gaps.
3. [CHECKLIST.md](CHECKLIST.md): implementation sequence, acceptance states and cutover gates.
4. [reference/src](reference/src): runnable source, fixtures and component examples. [SNAPSHOT.json](SNAPSHOT.json) records provenance; the snapshot is a reference, not the new application architecture.

[Foundation and registry research](../../notes/ui-foundation.md) explains the earlier production setup. [OSS research](../../notes/oss-product-review.md) explains the six workflow additions. ROADMAP.md is the implementation status summary; the full ticket log is in git history.

## Run the reference

From the repository root:

```sh
pnpm --dir docs/design/openag-desk/reference install --frozen-lockfile --ignore-scripts
pnpm --dir docs/design/openag-desk/reference dev
```

Open <http://127.0.0.1:5191/?variant=A#/room/main>. The reference has its own pnpm workspace, lockfile and node_modules; it is outside the root `apps/*` workspace. It has no API proxy or daemon credentials. Installation skips lifecycle scripts. It uses a separate loopback port so the existing prototype on 5190 and daemon on 4747 can stay running.

```sh
pnpm --dir docs/design/openag-desk/reference build
cd docs/design/openag-desk/reference
shasum -a 256 -c SHA256SUMS
```

The build runs TypeScript and Vite only. Unit tests/Jest are not part of this handover and must not be run, including through scripts or hooks. A missing cached dependency may require registry access during installation.

## Useful reference routes

| Screen | Hash route / interaction |
| --- | --- |
| Group conversation | `#/room/main` |
| One bot | `#/room/direct-coder` (fixture ID only; production must use the server's real room ID) |
| Work | `#/work` -> open a work item |
| Needs you / exact review | `#/inbox` -> approval, question or recovery item |
| Computer / ledger | `#/computer`, `#/ledger` |
| App discovery / installed connections | `#/app-library`, `#/connectors` |
| Bots / avatar editor | `#/bots/coder` -> click the avatar |
| Models / routing | `#/settings/models` |
| Proactive / memory / devices | `#/settings/proactive`, `#/settings/memory`, `#/settings/server` |
| Automations / run history | `#/automations` -> last outcome |

Layout A is the working integration reference. B/C are preserved comparisons, not three required production layouts. Use the header theme toggle for light/dark; reload clears all fixture edits. The prototype's simulation controls are for inspecting outcomes, not production controls.

## Frozen evidence and maintenance

The [screenshots](screenshots) folder contains a fresh capture set from this repo-local copy. See [VERIFICATION.md](VERIFICATION.md) for exact checks and limitations. Screenshots are visual evidence; source interactions explain motion and state transitions. The reference is not an exhaustive accessibility specification or proof of a live integration.

Keep this snapshot stable during implementation. Change production code under the relevant ticket and record any deliberate design deviation there. If the owner changes the design, update this contract, the affected reference and the checksum manifest together. Avoid maintaining two independent production UI implementations.
