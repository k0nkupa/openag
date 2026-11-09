# Cached model selection

New agent creation, chat, agent settings and room routing share the native shadcn DropdownMenu model picker, grouped by source. Agent settings, chat, new-agent creation and reasoning controls use the daemon’s persisted catalogue. Opening, selecting and saving use cached choices without contacting model providers. Room routing uses the same cached task eligibility in the daemon; its existing configuration/revision validation remains separate.

## Refresh and availability

Settings → Models → Model catalogue shows the last successful refresh and any failure for each configured source. **Refresh models** checks those sources now. The daemon checks for due refreshes at startup and hourly; a source is refreshed at most once per 24 hours automatically. Restart does not reset that schedule. An unsuccessful attempt also advances the next automatic attempt, avoiding a retry loop. Manual refresh remains available.

A first install has no cached models until its initial background refresh completes. Opening a picker does not trigger that work. Configured credentials and installed adapter packages determine which sources are offered. A failed source retains its last successful metadata; other successful sources remain available. Known credential, endpoint or installed catalogue/adapter-version changes invalidate that source's cached data. A manual refresh or the next background check must populate its new source context.

Implementation follows the official shadcn model-selector composition on the installed Base UI DropdownMenu. All model callers share provider-labelled radio groups, separators, checked selection and keyboard controls; there is no search field or provider-letter artwork. Form triggers stay full-width and 44px; chat uses compact circular CPU and brain icon triggers. Accessible names and focus/hover tooltips identify the control and current selection; opened menus keep full labels and checked choices. Menus remain viewport-bounded.

The catalogue contains model lists and per-model reasoning options, sanitized before storage in the daemon SQLite database. It stores no raw credentials, session IDs, approval state or probe processes. Source context uses a one-way configuration fingerprint. Hosted lists are fetched once per source refresh; capabilities come from provider metadata and the maintained v2 catalogue; reasoning controls retain the returned provider details and installed reasoning catalogue. ACP refresh uses one disposable session per adapter and reads each model's reported controls without a prompt. Models with an explicit configuration rejection are omitted with an explanation; authentication/transport failures still fail the source and retain its last successful catalogue. Ollama uses tags/show; only models reporting completion capability appear as chat choices. The Local status inventory lists all installed models, including embedding and audio models. Missing reasoning metadata stays unavailable rather than inventing options.

Discovery is bounded: provider fetches have timeouts and response caps, ACP source probes have a 90-second budget and a 100-model cap, and stored catalogues have size/count limits. Overlapping refreshes share source work. Shutdown prevents refresh writes before closing the database.

## Save and runtime changes

Browsing cached choices does not require the agent to be idle. Saving does: active turns, pending approvals, questions and unresolved actions retain the existing block. Only the owner or a Full device can refresh or change model configuration.

Selection and save validate cached model-specific controls, configuration revisions, administrator overrides and the catalogue generation. There is no five-minute expiry and no live pre-save validation. A completed refresh invalidates old choice tokens; removed models or changed reasoning require the owner to review the draft. An uncertain save is read back, never automatically replayed. Creation tokens remain bound to their creation request ID.

Existing agents can switch between Codex/Claude and Ollama through Model and reasoning. The chosen target determines the runtime; identity, conversation records, memory, skills, permissions and room membership are preserved. Incompatible reasoning values are removed from the draft for review. Old ACP connections close before the audited atomic save. Each actual model change receives a new session generation, so switching away and back cannot resume an old session. The next turn uses the existing authorized conversation-history path. No turn starts merely because a model was saved.

ACP session setup still applies the requested configuration and permission mode. Ollama sends the saved thinking value with chat generation without a separate per-turn reasoning lookup. Actual provider rejection is an execution failure, not authority to silently choose another model. Daily metadata may be stale; cache presence proves neither account access nor inference acceptance. Model changes here do not change the memory embedding model.

## Verification

Use workspace builds and standalone gateway/mounted-UI assertions, not unit/Jest/Vitest runners. `scripts/verify-model-catalogue.mjs` covers passive cached operations, persistence, refresh timing/failures and runtime changes. Existing model/creation checks exercise policy gates and lost-response handling. `scripts/verify-model-catalogue-real.mjs --real` is a separate bounded acceptance command: two tiny turns through each real subscription adapter and two through local Ollama, in disposable data. Running controlled checks does not establish real acceptance or deployment.

## Capability-based eligibility

The shared catalogue stores supported, unsupported or unknown task capabilities,
input modalities, metadata source and refresh time. It covers chat, image input,
recorded-file transcription, decisions and embeddings. A provider's model ID is
not required to appear in the installed SDK's model list. Eligibility uses reported
model type and compatible protocol metadata rather than model-name patterns.
Unknown metadata never becomes a positive capability. Saved pre-upgrade chat
catalogues remain readable until refresh; no agent or transcription target is
silently replaced. Existing configured embedding/routing defaults remain separate.

Models.dev's fixed versioned v2 feed supplies hosted capability/protocol data;
its older feeds omit transcription-only records. The daemon bounds this fetch at
16 MiB, validates the consumed schema, sends it no credentials and never uses its
URLs, SDK names or instructions as transport configuration. Provider metadata
wins for fields it actually reports. Ollama tags/show and Typesafe's dedicated
decision-model list remain authoritative for their respective paths. Supported
provider transports and credential handling are still explicit application code.
Source evidence and feed coverage: [capability sources](model-capability-sources.md).

Only compatible known task choices appear in pickers. New model names need no
application edit when their capability metadata and supported transport qualify.
Recorded-file transcription requires the transcription protocol; realtime-only
models are excluded. Hosted image delivery uses cached image capability metadata,
not a family regex. An unknown image capability sends attachment metadata only;
the agent must not claim to have viewed unavailable image content. The catalogue
is capability evidence, not proof of account access or a successful inference.

Ollama model lookup treats an omitted tag as `:latest`, following its API convention,
without rewriting saved targets. Explicit tags and digest references remain distinct.
