---
status: accepted
---

# Retain request provenance without promising replay

OpenAg needs to explain model context without duplicating unrestricted private provider payloads or claiming visibility into ACP internals. Use bounded, redacted request manifests with source references, fingerprints, explicit omissions and observation boundaries, linked to model steps and attempts. This sacrifices exact reconstruction of mutable/private context in exchange for a smaller retained privacy surface; a future full-snapshot or replay feature would require a separate retention and consent decision.

Keep action receipts and permission sessions authoritative for effects and authority. Provenance cannot clear uncertainty, rerun actions or infer a child CLI's hidden context. The owner approved the implementation plan on 4 November 2026, including metadata-only retention and the desk-to-gateway verification boundary. Acceptance and deployment are tracked separately in the implementation note.
