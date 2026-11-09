export interface ConnectorSignIn { callbackOrigin: string | null; deskOrigins: string[] }

export function validDeskOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.port !== "0" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  } catch { return false; }
}
export function validCallbackOrigin(value: string): boolean {
  return validDeskOrigin(value) && safe(new URL(value));
}

/** Installation configuration chooses the callback; browser input never selects it. */
export function connectorCallback(env: NodeJS.ProcessEnv, localOrigin?: string, configuredOrigin?: string | null): string {
  const legacy = env.OPENAG_COMPOSIO_REDIRECT_URI;
  const base = env.OPENAG_PUBLIC_URL ?? configuredOrigin ?? localOrigin;
  let derived: string | undefined;
  if (base) {
    const url = new URL(base);
    if (!safe(url) || url.pathname !== "/") throw Error("Set this installation's app address to an HTTPS origin, without a path, on the OpenAg computer.");
    derived = new URL("/composio-connect", url).href;
  }
  let uri = legacy ?? derived;
  if (!uri) throw Error("Open the desk on the OpenAg computer, or set this installation's HTTPS app address for phone and remote sign-in.");
  const url = new URL(uri);
  if (!safe(url) || url.pathname !== "/composio-connect") throw Error("The saved Composio return address needs attention on the OpenAg computer.");
  uri = url.href;
  if (legacy && env.OPENAG_PUBLIC_URL && derived !== uri) throw Error("The installation app address and legacy Composio return address disagree. Keep the original address or update both deliberately on the OpenAg computer.");
  return uri;
}

export function trustedDeskOrigin(origin: string, callback: string, localOrigin: string | undefined, configured: string[]): string {
  if (!validDeskOrigin(origin) || new URL(origin).origin !== origin) throw Error("The desk address must be an origin without a path, query or fragment.");
  const target = new URL(callback);
  if (![target.origin, localOrigin, ...configured].includes(origin)) throw Error("Add this desk address under Sign-in addresses from a Full access device before connecting.");
  if (target.protocol === "http:" && origin !== target.origin) throw Error("Remote sign-in needs a reachable HTTPS callback. Set it under Sign-in addresses; keep using this desk address.");
  return origin;
}

function safe(url: URL): boolean {
  return (url.protocol === "https:" || url.protocol === "http:" && url.hostname === "127.0.0.1") && url.port !== "0" && !url.username && !url.password && !url.search && !url.hash;
}
