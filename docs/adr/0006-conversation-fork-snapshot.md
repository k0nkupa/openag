# Conversation forks preserve evidence

Status: owner-approved, 5 November 2026.

The owner chose a new conversation rather than truncating or restoring the existing one. A fork is a named room with the same members and lead, a bounded owner-selected text snapshot and fresh sessions/permission context. It starts no turn. The snapshot is supplied as untrusted context to hosted and ACP runtimes; isolated, external-source, noIndex and investigation runs exclude it.

Use an atomic creation receipt and snapshot mapping so an uncertain response can be reconciled and a retry cannot duplicate the room. Keep the original events, attachment bytes, approvals, receipts and effects in place. Copied transcript rows retain source references but are not fabricated runtime turns. Subsequent input gets the snapshot explicitly, without relaxing the existing bot-participation history filter. No new source-room history reads occur after creation.

Limit this first fork to 200 candidate message events and 24 KiB of serialized redacted text. Attachment names and original-room references remain available, but bytes and grants are not adopted. The new room uses default lead routing; source-specific routing is not silently copied. A full content/attachment clone, larger-history pagination and conversation rollback are separate features.
