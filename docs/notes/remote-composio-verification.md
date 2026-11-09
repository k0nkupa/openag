# OA-366 remote Composio sign-in

Approved implementation plan: separate desk origins from the provider callback, complete on the daemon, preserve existing access during migration, and verify cross-origin browser behavior without live provider or network changes. Baseline `716b369`; branch `codex/remote-composio-signin`.

## Implemented contract

- The owner/Full-only `connectorSignIn` setting stores a callback origin and up to twenty approved desk origins. The Composio panel pre-fills the current desk for explicit approval. Origins exclude userinfo, paths, query and fragments. Existing callback environment overrides have higher priority and are shown read-only; no secret is accepted in the form.
- The existing `/composio-connect` path is now a server receiver before Bearer/static middleware. It consumes only a matching pending attempt created by an authenticated start. PKCE, state expiry, actor binding, current Full-device authority before exchange and before commit, cancellation, disconnect and configuration invalidation apply. A supplied issuer must match the fixed provider. Query length, duplicate parameters and failed unknown probes are bounded.
- The receiver grants no device access. It returns only a non-secret display hint to the recorded approved desk origin; no codes, state or owner/device/provider credential is forwarded. The desk removes the hint from history and reads authoritative account status using its existing credential. A forged hint cannot connect an account.
- A working account remains usable while callback setup changes or a replacement sign-in fails. New callbacks use fresh registration when the old registration does not match. Refresh of a legacy record does not invent an unproven callback for its old client. Google callback behavior, encrypted stores, key-recovery guards, legacy authenticated completion and tool approval/no-replay policy remain.
- No Tailscale Serve, Cloudflare, DNS, HTTPS trust-store or live account configuration was performed. The saved callback must already route to this installation. Private tailnet callbacks require tailnet reachability; a future Cloudflare-only browser needs a callback reachable in that mode.

## Verification

The first new assertion reproduced the original failure: an approved HTTP desk could not use a separate HTTPS callback. It passed after address separation.

`pnpm -r build` passed. Standalone remote callback/browser, Composio connection/desk, managed-onboarding, Google, connector-isolation, owner-access and bot-knowledge checks passed. No unit/Jest/Vitest runner was used. The existing bundle-size and HomeView/Base UI fixture warnings remain outside this change.

The new remote fixture uses the actual MCP SDK, gateway, SQLite and encrypted store with controlled provider endpoints. It covers Full/Limited authority, malformed/unapproved origins, denied consent, wrong issuer/state, expiry/replay/duplicates, revocation/downgrade, a permission change during a held exchange, failed reconnect preservation, configuration invalidation, alias reuse without registration churn, redaction and private ciphertext.

The actual browser check runs two local origins: paired HTTP desk and an HTTPS receiver using an isolated self-signed fixture certificate. It proves the HTTPS origin has no device token, completes the controlled callback there, follows the redirect to the original HTTP origin, retains the original device credential, removes the display hint and reads the connected account. Provider consent itself is simulated; no real Composio URL is opened. TLS error bypass applies only to this disposable browser fixture.

A separate probe assertion reproduced an early implementation gap where unknown callback codes entered the permanent redactor set. The final receiver rejects unknown state before registering codes, and throttled unknown probes cannot deny a valid pending callback. Regression assertions cover both.

DOM checks cover the address form, Full-only editing, save/cancel, untrusted authorization URLs, legacy Google/Composio authenticated returns, successful/cancelled server-return hints, and forged success hints without connection state. Existing SDK/MCP/runner checks retain external-action approval and no replay.

Knowledge sources: docs/composio.md, docs/help/computer-connectors.md, docs/cloudflare-tunnel.md and aligned AGENTS.md/CLAUDE.md. The bot-knowledge verifier checks the new explanation in packaged content and controlled API/Ollama/cached ACP/MCP/default-bot delivery.

Independent Standards/Spec and built-in Codex reviews passed. Standards suggested requiring the authority predicate on the exported completion API; it is now mandatory, all callers are explicit, and the focused follow-up passed. The full build, SDK integration and actual two-origin browser checks passed again after that tightening. The final built-in review found no actionable defects. Physical-phone consent, provider acceptance of a chosen callback, tunnel/Access routing and deployed behavior remain unverified.
