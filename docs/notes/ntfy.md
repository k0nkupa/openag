# ntfy publish API (verified for OA-118)

Source: https://docs.ntfy.sh/publish/ (fetched 2026-10-27).

- **Publish as JSON:** `POST` (or `PUT`) to the server **root** (`https://ntfy.sh/`), `Content-Type: application/json`, not to a topic path.
  `topic` is the only required field, so the secret topic never appears in a URL (and so not in proxy/access logs).
  Optional fields used here: `message`, `title`, `priority` (integer 1-5, 3 = default), `click` (URL opened on tap).
  Also available but unused: `tags`, `icon`, `markdown`, `actions`.
- Success returns a JSON body with an `id`; treat any non-2xx as a failure and never retry-storm (429 = back off).
- Auth for protected servers: `Authorization: Bearer tk_...`. Not implemented: we use the public ntfy.sh with a secret random topic (user's choice), so the topic IS the credential.
- Messages over 4096 bytes become attachments: we cap titles at 60 and bodies at 200 characters.
- ntfy.sh is a third-party public relay: messages may be cached for a while and the topic is the only protection. Hence: random 128-bit topic, minimal text (no payloads, paths, or secrets), details off by default.
