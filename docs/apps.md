# Apps SDK (OA-208)

An App adds tools to every bot. It is a FOLDER you copy into `$OPENAG_DATA/apps/<id>/` (default `~/openag-data/apps/<id>/`).
There is no marketplace, no HTTP install and no download: if it is not on disk because you put it there, it does not exist.

## Trust model (read this first)
An App is **code you trust**. Enabling it lets it run on this machine as the daemon's OS user, with full file and network
access. OpenAg does not sandbox the code; it controls who decides and what the model can reach:
- An App does nothing until the OWNER enables it (desk Settings, Apps; owner token only). The approval is bound to the
  sha256 of the WHOLE folder you reviewed (manifest.json and every code file, except `data/`; at most 200 files / 5 MB;
  symlinks are refused): change any file and the App is disabled again (checked on every call). A bot with file-write
  access could otherwise rewrite the tool's code and keep an approval.
- Tools run OUT OF PROCESS (never imported into the daemon). The command line is fixed by the manifest; the model's
  arguments go ONLY to stdin as JSON, after being validated against the schema you declared (strict: unknown keys fail).
- The child gets a minimal environment (`PATH`, `HOME` = the app's private `data/` folder, `LANG`, `TMPDIR`) plus the
  variable NAMES you declare in `exec.env`; `OPENAG_*` and `PATH`/`HOME`/`TMPDIR`/`LANG` can never be overridden. An
  interpreter (`node`, `python3`, `sh`, `bash`) must be given a script or `-c` argument, never read the model's input as code. Stderr is discarded. A time limit kills the whole process group;
  output is capped at 1 MB.
- Cancellation, a permission change or daemon shutdown stops an admitted App's owned process group and waits for the child to exit. Effects already performed are not undone. Interrupted effectful calls retain Unknown evidence and are not automatically replayed. Historical uncertainty requires no manual inspection form.
- Every call still goes through the policy gate as `app_<id>_<tool>` with the class you declared (`read`, `search`,
  `browse`, `act-local`, `act-external`; `secrets` cannot be declared). `act-external` can never be auto. Results are
  wrapped as untrusted data and redacted.

## Layout
```
apps/<id>/manifest.json     required (<= 64 KB)
apps/<id>/...               your code (symlinks anywhere inside are refused)
apps/<id>/data/             created by OpenAg: the tool's HOME (mode 700)
```
`<id>` is 2-24 lowercase letters/digits and must equal the folder name and the manifest `id`.

## manifest.json
```json
{
  "id": "hello", "name": "Hello", "version": "1.0.0", "description": "...",
  "tools": [{
    "name": "note",
    "description": "What the model sees",
    "class": "act-local",
    "input": { "type": "object", "properties": { "text": { "type": "string", "maxLength": 200 } }, "required": ["text"] },
    "exec": { "argv": ["node", "tool.mjs", "note"], "timeoutSec": 10, "env": ["MY_API_KEY"] }
  }]
}
```
- `input` is a small JSON-Schema subset: `object` with properties of type `string` (`maxLength`, `enum`), `number` / `integer`
  (`minimum`, `maximum`), `boolean`, `array` of primitives (`maxItems`); `required`; no `$ref`, no nesting, no
  `additionalProperties: true`.
- `exec.argv[0]` is `node`, `python3`, `sh`, `bash`, or a RELATIVE executable inside the folder. Other arguments are fixed
  strings. `timeoutSec` 1-120 (default 30). `exec.env` lists variable names to copy from the daemon's environment.
- The tool reads one JSON object on stdin and prints its result on stdout (JSON, or plain text). Exit 0 for success;
  a non-zero exit is an error (the owner sees a short redacted hint).

## Using it
1. Copy the folder (see `examples/apps/hello/`) into the apps directory.
2. Desk, Settings, Apps, Reload, "Review and enable" (check the command lines and classes), Enable.
3. Bots see `app_hello_time` and `app_hello_note`; ACP bots get them through the daemon's MCP endpoint.

API (owner token for everything that changes state): `GET /apps`, `POST /apps/reload`, `POST /apps/:id/enable {hash}`,
`POST /apps/:id/disable`.


## App library

The desk's App library and Settings → Connectors use `GET /app-library`, a read-only projection of installed Apps/MCP status and the shipped example catalogue. Reload app folders detects local additions; it never downloads code. Review and enable remains bound to the current whole-folder hash. Explicit disable stores a separate pause digest only for display, with no execution approval; changed/removed code loses that marker. Old disabled folders require review rather than inheriting an assumed paused state. Ready reports local prerequisites, not provider account authentication. Supported local setup is available through owner-only `GET /app-library/setup/:id` for the shipped Hello App, Local reference MCP and Apple apps facade. The desk reviews the exact target/source/digest; an administrator runs the fixed local command, then the desk detects it. Apps still need a fresh Review and enable. See [reviewed setup and rollback](notes/integration-setup/README.md).


Gmail and Google Drive are daemon-owned read/search connectors with separate service controls and one shared Google account. Apple apps uses a pinned local MCP facade with explicit per-app access checks. See [connector setup, scope, recovery and verification](notes/read-connectors.md); deployment, native permissions and live-account acceptance remain separate owner-authorised steps.
