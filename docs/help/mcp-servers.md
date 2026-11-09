# MCP servers

An MCP server is a tool provider OpenAg connects to. Three kinds appear under Settings, Connectors:

- **Built in to OpenAg** (the Apple apps connector): managed by OpenAg and read-only here.
- **Connections** such as Composio: managed from their own sign-in screen.
- **Custom servers**: added by the owner. Only a Full access device (the owner) sees the controls; a limited device sees none, and the daemon refuses its changes.

## Add, edit and remove a custom remote server

Settings, Connectors, **Add MCP server** asks for a name (lowercase letters, numbers, hyphens, underscores; it cannot change later), an address and optional headers. Keep credentials out of the address. Open a custom server's details for **Server settings**: an Enabled switch, an Offer tools to agents switch (both save at once), **Edit** and **Remove** (Remove asks first and cancels approvals waiting for that server's tools). If mcp.json changed somewhere else, the desk reloads it: fields you did not edit show the latest version, yours are kept, and you save again. A custom server that runs a local command is not editable from the desk; it stays in mcp.json until its command review exists.

## Header values are references

A header value refers to an environment variable named `OPENAG_MCP_<NAME>` that the administrator sets on the OpenAg machine, for example `Bearer ${OPENAG_MCP_EXAMPLE}`. The desk never accepts or shows an environment variable's value; for a value you type in the desk, use a stored secret (below). An existing reference may stay while the server keeps its host; pointing a server at a different host means every reference must be an `OPENAG_MCP_` variable. A value shown as hidden (redacted) is never saved back; type the reference again. References to OpenAg's own secrets, API keys or channel credentials are refused. `OPENAG_MCP_` variables are kept away from agent processes.

## Stored secrets

A header value can also be `${secret:NAME}` (capital letters, digits and `_`). When a header refers to one, the add and edit dialog shows a write-only field for it. The value (at least 12 characters, no spaces) is saved encrypted on the OpenAg machine after the server is saved, is never shown again (the field shows only whether it is set and its last four characters) and is never written to `mcp.json`. Each secret belongs to one server and works only for that server's address: changing the address, or removing the server, deletes its secrets. A missing or deleted secret leaves the server skipped as `missing secret NAME`; nothing is sent without it. Secrets are kept away from agent processes. Typing a credential straight into a header or address is still refused. Server checks use the stored secrets of the server being edited, and only for its current address; a check of an unsaved server cannot use any. Stdio servers cannot use stored secrets yet.

## Local commands

Under Settings, Connectors, **Add local command** adds a server that runs a program on the OpenAg computer. Nothing is saved or started until you review it: the review shows the exact program (resolved to its real path), its arguments, the environment variable names, the working directory (`mcp-work/<name>` in the data directory) and a review code, with a warning that it runs with your user's permissions and is not sandboxed. Approve it or cancel; any change to the program, arguments, environment or a named script file needs a new review, and a program or script that changed since the review is not started. Shells, wrappers such as `env` or `sudo`, and inline code (`sh -c`, `node -e`) are refused, and an interpreter such as `node` needs an existing script, given by its absolute path, as its first argument. Variables that change how programs start (PATH, NODE_OPTIONS, PYTHONPATH, LD_PRELOAD and similar) cannot be declared. Only the owner can approve a review. Only PATH, HOME, LANG, TMPDIR and the environment names you declare are passed; a declared value can be `${OPENAG_MCP_NAME}` or a stored secret `${secret:NAME}`. Commands written in `mcp.json` by the administrator stay managed there. The review covers the program and the script files named in the arguments, not files a script imports or packages it downloads.

## Signing in with OAuth

Some servers ask you to sign in with the provider instead of using a key. In Add or Edit, switch on **Sign in with OAuth** (optionally a scope). The server then shows **Needs sign-in**; open its settings and choose **Sign in**. OpenAg opens the provider in a new tab, and the provider sends the result back through OpenAg's managed callback route (never an address you type). Until you sign in, the server's tools are not offered. OpenAg checks the provider's sign-in service before using it (https, PKCE, matching issuer) and keeps the tokens encrypted on the OpenAg computer; they are never shown. If the provider needs a registered client, enter its client ID (and secret) under **Registered client**; otherwise OpenAg registers itself when the provider allows it. If access is lost or more access is needed the server goes back to **Needs sign-in**, and the action that found out is not retried. **Disconnect** removes the grant from this computer only; it does not ask the provider to revoke it. Changing the server's address, removing it, or turning OAuth off deletes its sign-in.

## Check server

**Check server** proposes a check and shows it as an approval in the same dialog. OpenAg contacts the server only after you accept. It lists up to 50 tool names with their descriptions (untrusted text from the server), saves nothing and makes no tool available. Cancel check, or an unanswered check expiring after 5 minutes, contacts nothing. Approving a check does not approve any tool the server offers.

## Offering tools to agents

With **Offer tools to agents** on, a connected server's tools are offered to every kind of agent; with it off they disappear from every agent's list while the server stays connected. Offering does not approve anything: an MCP tool cannot enforce a filesystem boundary, so it runs only when the agent is in Full access and is refused in the confined modes. In Full access OpenAg creates no approval for it; whether an unconfirmed result is reported as unknown still depends on the tool's class, which the owner can declare read or search in mcp.json.

## Addresses and common statuses

Servers must use https and a public address. A server on this machine, your local network or Tailscale needs **Allow private network** on that server, and plain http is only allowed together with it. Link-local and cloud-metadata addresses are never allowed. Statuses you may see: "blocked private address", "http requires allowPrivateNetwork", "header references a daemon secret", "missing env NAME" (the named variable is not set for the daemon), "connect failed" or "connect timed out" (the server is unreachable).

## Answering questions

Describe what the desk shows and what the administrator must do (set a variable, allow private network, use https). Do not claim a server works unless its status says Connected, and do not claim a check ran unless the result is shown. This topic describes the implemented desk and daemon behavior; whether a real agent has called a custom server's tools in a live session is not established by it.

Only the owner or a Full device can decide server checks and command reviews. Refused configuration saves retain working credentials. Disconnect cancels pending sign-in attempts as well as stored local access.

Existing operator-installed business MCP headers can keep their dedicated legacy credential reference. New desk-added references use `OPENAG_MCP_<NAME>`. Credentials still stay out of bot processes.
