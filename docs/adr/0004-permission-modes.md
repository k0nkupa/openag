---
status: accepted
---

# Replace category permissions with session permission modes

The owner selected DSH-style permissions because independent per-category Auto/Ask/Deny settings make ordinary agent work inconsistent. Replace that authority model with a session-scoped filesystem boundary plus Ask/Never approval policy, using Read Only, Workspace Write and Full access. Categories remain descriptive; the old external/secrets Auto locks are deliberately retired when the replacement passes acceptance.

Keep OpenAg's authoritative gate, owner access controls, redaction, independent isolation ceilings and action evidence. Full access removes confinement and routine prompts; an explicit approval request under Never is refused. Unsupported confinement fails closed. This decision is implemented in local source, with upgraded installations requiring explicit owner adoption. No deployment is claimed; see the [domain model](../notes/permission-modes-domain-model.md) and [spec](../specs/permission-modes.md).

The owner subsequently selected daemon-owned execution after OA-398 measured native callback bypass and hook failure behavior. API/Ollama call the same execution interface as ACP models using the daemon MCP endpoint. Native effectful tools and inherited integrations must be disabled or refused with measured evidence; optional native hooks are not the authority.
