# Conversation forks (OA-468)

## Current desk behavior (OA-471)

The owner removed chat checkpoints. Feed no longer shows Checkpoint or Fork from here. The unused desk component, Marker primitive and fork-creation client method are removed. Existing forked rooms, migration 037, stored transcripts and the guarded daemon compatibility endpoint remain intact. Delivered help explains the removal. The implementation and acceptance notes below describe the original feature; the creation control is no longer offered.

A fork creates a new named room from an owner-selected visible message checkpoint. The original history, attachments, approvals, receipts and effects remain in place. No turn or Work starts on creation. The new room has the same members and lead, default lead routing, fresh adapter sessions and the normal permission defaults. Room-specific routing and permission grants are not copied.

The snapshot contains at most 200 candidate message events and 24 KiB of serialized redacted text. Internal consultations and hidden execution rooms are excluded. Original attachment names and a link back remain visible, but attachment bytes/IDs are not adopted. Oversized checkpoints fail atomically, without creating a partial room. New secrets registered after the original messages are re-redacted when the snapshot is created and read.

Migration 037 stores the source room/checkpoint identity and snapshot. Creation uses the existing room creation receipt inside a ledger-atomic transaction. Repeating the same creation id reuses the same room; a different checkpoint with that id is refused. The desk Checkpoint marker uses the native Marker/Button composition for Full devices. Unconfirmed creates retain their identity in session storage and offer a read-only status check; they do not automatically send a second create. API changes invalidate pending responses.

Copied transcript rows are presentation, not fabricated runtime turns. Hosted and ACP input receive the snapshot explicitly as untrusted contextual data. The existing bot-participation history filter is unchanged. Isolated, external-source, noIndex and investigation turns exclude the snapshot. Knowledge and conversation content never grant tool permissions or authorize replay.

## Verification

Recursive build passed. scripts/verify-conversation-forks.mjs covers real gateway/runner/storage with controlled runtimes: Full/Limited access, cutoff/hidden-room boundaries, atomic/idempotent creation, no automatic turns or approvals, attachment references, size/redaction, hosted contextual data and database reopen/integrity. scripts/verify-ai-patterns.mjs covers the actual checkpoint UI after a lost create reply, remount and status reconciliation with no second create. Existing hosted context/isolation checks passed. Packaged help includes the conversation-forks topic, with default/cached bot delivery verified through scripts/verify-bot-knowledge.mjs.

Codex passed a real fresh/reused no-tool adapter journey, receiving the selected marker and excluding later messages. Evidence: /var/folders/x4/cs8jlkqs3hzgh5v1jcx1kk1r0000gn/T/openag-forks-acp-gbWL4C/acceptance.json. The earlier Claude turn 10bfa292-7ba9-4230-a1ea-a8edb6ba3906 failed at its session quota with no pending approvals. The owner explicitly instructed skipping Claude; it was not retried. Claude acceptance is not claimed.

Source/controlled acceptance, migration rehearsal, deployment and rendered acceptance are distinct. Deployment evidence is recorded separately in the dated release note. No unit/Jest/Vitest runners or production model/provider canaries were used. Local browser use was previously disabled; new rendered desktop/phone/theme/scroll acceptance is unverified.
