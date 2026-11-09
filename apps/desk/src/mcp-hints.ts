/** One plain sentence for the common MCP server problems the daemon reports as fixed reasons. Null when there is nothing specific to say. */
export function mcpHint(detail: string | undefined): string | null {
  if (!detail) return null;
  if (/blocked private address/.test(detail)) return "This address is on this machine or a private network. If that is intended, turn on “Allow private network” for this server. Link-local and cloud-metadata addresses are never allowed.";
  if (/http requires allowPrivateNetwork/.test(detail)) return "Plain http is only allowed for servers on this machine or a private network. Use https, or turn on “Allow private network”.";
  const secret = /header references a daemon secret \(([A-Za-z0-9_]+)\)/.exec(detail);
  if (secret) return `A header can only reference variables named OPENAG_MCP_<NAME>, not ${secret[1]}.`;
  const reference = /can reference only OPENAG_MCP_ variables \(([A-Za-z0-9_]+)\)/.exec(detail);
  if (reference) return `Use a variable named OPENAG_MCP_<NAME> instead of ${reference[1]}; the administrator sets it on the OpenAg machine.`;
  if (/looks like it contains a secret|redaction marker/.test(detail)) return "Do not type a credential here. Reference a variable such as ${OPENAG_MCP_NAME} instead.";
  if (/^needs sign-in/.test(detail)) return "Sign in from this server’s settings. Until then its tools are not offered.";
  const secretMissing = /missing secret ([A-Z0-9_]+)/.exec(detail);
  if (secretMissing) return `Enter the value for secret ${secretMissing[1]} in this server’s Edit dialog.`;
  const missing = /missing env ([A-Za-z0-9_]+)/.exec(detail);
  if (missing) return `Set ${missing[1]} in the OpenAg daemon's environment, then reconnect.`;
  if (/connect failed|connect timed out|list timed out/.test(detail)) return "OpenAg could not reach the server. Check the address and that the server is running.";
  return null;
}
