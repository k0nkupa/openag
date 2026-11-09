import { BlockList, isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

/** Fixed short reasons only: never the URL, host or address, so status text cannot leak a target. */
export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SsrfBlockedError";
  }
}

const REASON_PRIVATE = "blocked private address";
const REASON_HTTPS = "https required";
const REASON_URL = "invalid url";
const REASON_USERINFO = "credentials in url not allowed";

/** "never" is refused even with the owner's allowPrivateNetwork opt-in: link-local and known cloud-metadata hosts, unspecified, multicast, documentation and other reserved space. */
type AddressClass = "public" | "private" | "never";

// Checked first, so a metadata host inside an otherwise opt-in range (100.100.100.200 in CGNAT, 192.0.0.192 in 192.0.0.0/24) stays refused.
const neverRanges = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["100.100.100.200", 32], ["169.254.0.0", 16], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) neverRanges.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["fe80::", 10], ["ff00::", 8], ["fd00:ec2::254", 128], ["100::", 64], ["2001:db8::", 32],
  ["2001::", 32], // Teredo embeds an obfuscated IPv4
  ["64:ff9b:1::", 48], // local-use NAT64
] as const) neverRanges.addSubnet(net, prefix, "ipv6");

// The ranges an owner may opt into: loopback, LAN, CGNAT/Tailscale, ULA and deprecated site-local.
const optInRanges = new BlockList();
for (const [net, prefix] of [["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const) optInRanges.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::1", 128], ["fc00::", 7], ["fec0::", 10]] as const) optInRanges.addSubnet(net, prefix, "ipv6");

/** Expands an IPv6 literal (with optional dotted IPv4 tail) to eight 16-bit groups, or null when it is not one. */
function expandV6(raw: string): number[] | null {
  let text = raw.split("%")[0]!.toLowerCase();
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const parts = dotted[2]!.split(".").map(Number);
    if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    text = `${dotted[1]}${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

const v4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
const classV4 = (ip: string): AddressClass => (neverRanges.check(ip, "ipv4") ? "never" : optInRanges.check(ip, "ipv4") ? "private" : "public");

/** Classifies an address. Anything unparseable counts as "never"; IPv4 embedded in IPv6 forms takes the IPv4 class. */
export function classifyAddress(address: string): AddressClass {
  const ip = address.split("%")[0]!;
  const family = isIP(ip);
  if (family === 4) return classV4(ip);
  if (family !== 6) return "never";
  if (neverRanges.check(ip, "ipv6")) return "never";
  if (optInRanges.check(ip, "ipv6")) return "private";
  const g = expandV6(ip);
  if (!g) return "never";
  const zeros = (from: number, to: number) => g.slice(from, to).every(n => n === 0);
  // IPv4-mapped (::ffff:a.b.c.d), deprecated IPv4-compatible (::a.b.c.d) and SIIT-translated (::ffff:0:a.b.c.d)
  if ((zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) || (zeros(0, 4) && g[4] === 0xffff && g[5] === 0)) return classV4(v4(g[6]!, g[7]!));
  // NAT64 well-known prefix 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return classV4(v4(g[6]!, g[7]!));
  // 6to4 2002::/16 embeds the IPv4 in groups 1 and 2
  if (g[0] === 0x2002) return classV4(v4(g[1]!, g[2]!));
  return "public";
}

/** True when the address must not be requested under this policy. */
export function isBlockedAddress(address: string, allowPrivateNetwork = false): boolean {
  const kind = classifyAddress(address);
  return kind === "never" || (kind === "private" && !allowPrivateNetwork);
}

export interface UrlPolicy {
  /** Owner opt-in for loopback, LAN, CGNAT/Tailscale and plain http targets. Link-local, metadata and reserved ranges stay refused. */
  allowPrivateNetwork?: boolean;
}

/** Returns a fixed reason when the URL must not be requested, otherwise null. Judges the parsed, normalised hostname. */
export function checkUrl(raw: string | URL, policy: UrlPolicy = {}): string | null {
  let url: URL;
  try { url = new URL(String(raw)); } catch { return REASON_URL; }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && policy.allowPrivateNetwork)) return REASON_HTTPS;
  if (url.username !== "" || url.password !== "") return REASON_USERINFO;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return REASON_URL;
  if (isIP(host) !== 0 && isBlockedAddress(host, policy.allowPrivateNetwork)) return REASON_PRIVATE;
  return null;
}

type Resolve = (hostname: string, options: { all: true; family?: number; hints?: number }, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/** Connect-time resolver: every resolved address is checked, and only checked addresses reach the socket (no later re-resolution). */
export function guardedLookup(allowPrivateNetwork: boolean, resolve: Resolve): LookupFunction {
  return (hostname, options, callback) => {
    const family = typeof options.family === "number" ? options.family : options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : 0;
    resolve(hostname, { all: true, family, hints: options.hints }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      if (!addresses.length || addresses.some(a => isBlockedAddress(a.address, allowPrivateNetwork))) return callback(new SsrfBlockedError(REASON_PRIVATE), "", 0);
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

const shared = new Map<boolean, Agent>();
const testAgents = new Set<Agent>();
// node:dns.lookup's overloads do not unify with the structural Resolve type; the call shape (all:true, callback) is the one guardedLookup makes.
const makeAgent = (allowPrivateNetwork: boolean, resolve: Resolve) => new Agent({ connect: { lookup: guardedLookup(allowPrivateNetwork, resolve) } });
function sharedAgent(allowPrivateNetwork: boolean): Agent {
  let agent = shared.get(allowPrivateNetwork);
  if (!agent) shared.set(allowPrivateNetwork, agent = makeAgent(allowPrivateNetwork, dnsLookup as unknown as Resolve));
  return agent;
}

/** Releases the connection pools (daemon shutdown, tests). The next guarded request creates new shared pools. */
export async function closeSsrfAgents(): Promise<void> {
  const open = [...shared.values(), ...testAgents];
  shared.clear();
  testAgents.clear();
  await Promise.all(open.map(agent => agent.close().catch(() => undefined)));
}

export interface GuardedFetchOptions extends UrlPolicy {
  /** Test seams: a resolver (fake DNS) and an underlying fetch. Production uses node:dns and undici. */
  lookup?: Resolve;
  fetchImpl?: (input: URL | string, init?: Record<string, unknown>) => Promise<Response>;
}

/** Walks the cause chain for a guard refusal so the SDK's wrapping cannot hide the fixed reason. */
export function ssrfReason(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof SsrfBlockedError) return e.message;
  }
  return undefined;
}

/**
 * A fetch for user-supplied MCP URLs. Every request entering it (including each redirect hop the SDK follows) is checked,
 * redirects are never followed here, and the socket connects only to an address that passed the check at connect time.
 * Accepts a URL or string only; the SDK transport never passes a Request.
 */
export function createGuardedFetch(options: GuardedFetchOptions = {}): typeof fetch {
  const allow = options.allowPrivateNetwork === true;
  let testAgent: Agent | undefined;
  // A test resolver gets its own pool, recreated when closeSsrfAgents has closed it. Production never sets `lookup`.
  const dispatcherFor = () => {
    if (!options.lookup) return sharedAgent(allow);
    if (!testAgent || !testAgents.has(testAgent)) testAgents.add(testAgent = makeAgent(allow, options.lookup));
    return testAgent;
  };
  // undici's own Response type differs from the global one only nominally; callers and the SDK use the standard surface.
  const impl = options.fetchImpl ?? (undiciFetch as unknown as NonNullable<GuardedFetchOptions["fetchImpl"]>);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof input !== "string" && !(input instanceof URL)) throw new TypeError("guarded fetch accepts a URL or string");
    const reason = checkUrl(input, { allowPrivateNetwork: allow });
    if (reason) throw new SsrfBlockedError(reason);
    // Resolved per request so a closed pool is simply replaced. fetchImpl can observe a request but can never drop the pinned dispatcher.
    try {
      return await impl(input, { ...init, redirect: "manual", dispatcher: dispatcherFor() });
    } catch (err) {
      const refused = ssrfReason(err);
      if (refused) throw new SsrfBlockedError(refused);
      throw err;
    }
  }) as typeof fetch;
}
