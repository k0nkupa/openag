# User profile

Settings → Profile (`#/settings/profile`) edits the shared human display identity. This release has one human ledger actor, `user`; it does not add accounts or identify different people on paired devices. Full/owner access is required to save. Limited devices can read the profile.

## Name and image

Choose Upload image to select a JPG, PNG or WebP up to 5 MiB. File type/signature and file size are checked before decoding; decoded images must contain at most 20 megapixels. The Adjust your image dialog provides a circular preview, drag positioning, four arrow buttons and a keyboard-accessible zoom slider plus zoom buttons. Zoom is 1×–3×; positioning is bounded to keep the crop filled. Use image applies the crop to the form; Save profile persists it with the name. Cancel closes the editor without applying its image. Remove image resets the form to initials; save to persist removal. The file input resets after every selection, allowing the same file to be selected again.

Canvas produces a 256 × 256 JPEG at quality 0.85, capped at 64 KiB. Transparent pixels use a white background. Only this cropped image reaches the daemon; original filenames, metadata and original bytes are not uploaded. Cancelled/failed selections leave the saved image unchanged. Temporary object URLs are released when the image is closed, replaced or the form unmounts. The original cannot be re-edited after saving: upload it again for a different crop.

The daemon stores the cropped JPEG as a bounded data URL in `settings.profile` through the existing settings API. It independently checks encoded/binary size, JPEG signature/dimensions/end marker and canonical base64; external URLs, SVG, other formats and bot-avatar objects are refused on writes. This reuses the attachment image-header validator; it does not fully decode JPEG entropy data. Existing saved bot-avatar objects become initials on reads without losing the name; the stored row is replaced only on a later save. No database migration, upload directory or agent-avatar-library change is required.

Names are trimmed, required, capped at 40 characters and reject control/bidirectional formatting characters. Registered secrets are refused before storage. The audit records field names, never the image or profile contents. Changes update accessible chat sender labels and activity labels, including old messages, without changing stored actors or device/access records. Open desks reload the profile on its config event and on stream reconnect. Failed loads show an error and disable saves. Dirty profile/crop drafts use the desk leave guard.

Delivered bot help: overview handbook topic. This feature changes presentation only; bots must not treat the display name or image as proof of identity or new action authority. Uploaded photos remain private installation data and are not part of shared help.

Chat message rows omit visible sender names and avatars. Profile settings retain the uploaded-image editor and preview; the saved name labels messages for assistive technology. See [message presentation](conversation-model.md#message-presentation--5-november-2026).
