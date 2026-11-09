import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Alert, AlertDescription } from "./ui/alert";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, createApi, messageOf, pair } from "../api";
import {
  cleanDeviceName,
  defaultDeviceName,
  formatCode,
  normalizeCode,
  setRtcIdentity,
  setToken,
  readJoinInvite,
  clearRtcIdentity,
} from "../auth";
import {
  checkInvite,
  normalizeCode as normalizeRtcCode,
  type RtcInvite as WireInvite,
} from "../rtc/protocol";
import { createRtcTransport, type RtcTransport } from "../rtc/transport";

type Mode = "token" | "pair" | "rtc";

/** Parses and validates a pasted invite. Throws a plain Error naming the bad field; the text is never echoed. */
export function parseInvite(text: string): WireInvite {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("paste the invite JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("the invite must be a JSON object");
  const v = raw as Record<string, unknown>;
  const invite = { server: v.server, topic: v.topic, stun: v.stun, code: v.code, secret: v.secret } as WireInvite;
  checkInvite(invite);
  if (typeof invite.code !== "string" || normalizeRtcCode(invite.code).length !== 8) throw new Error("invite: bad code");
  if (invite.secret === undefined) throw new Error("invite: missing secret");
  return invite;
}

export function Login({ notice, onSignedIn, invite, onCancel }: {
  notice: string | null;
  onSignedIn: (token: string) => void;
  invite?: { code: string; full: boolean } | null;
  onCancel?: () => void;
}) {
  const [joinInvite] = useState(() => invite ?? readJoinInvite());
  const joinCode = joinInvite?.code;
  useEffect(() => {
    if (joinInvite) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [joinInvite]);
  const [mode, setMode] = useState<Mode>("pair");
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [deviceName, setDeviceName] = useState(() => defaultDeviceName());
  const [value, setValue] = useState(() => (joinCode ? formatCode(joinCode) : ""));
  const [inviteText, setInviteText] = useState("");

  function switchMode(next: Mode) {
    setMode(next);
    setValue("");
    setInviteText("");
    setError(null);
  }

  async function finish(token: string, rtc = false) {
    if (!rtc) clearRtcIdentity();
    setToken(token);
    setValue("");
    onSignedIn(token);
  }

  async function submitToken(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = value.trim();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const api = createApi(token, () => {});
      const who = await api.whoami();
      if (who.kind === "device") {
        await finish(token);
        return;
      }
      // Owner token: keep only the device token it mints. The owner token is never stored.
      const { token: deviceToken } = await api.createDevice(cleanDeviceName(deviceName) || "This browser", "full");
      await finish(deviceToken);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("Wrong token");
      else if (err instanceof ApiError && err.status === 0) setError("Cannot reach the daemon");
      else setError(`Sign-in failed: ${messageOf(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitPair(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = normalizeCode(value);
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = await pair(formatCode(code), cleanDeviceName(deviceName) || "This browser");
      await finish(token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setError("Invalid or expired code");
      else if (err instanceof ApiError && err.status === 429)
        setError(
          err.retryAfter
            ? `Too many attempts. Try again in ${err.retryAfter} seconds.`
            : "Too many attempts. Try again later.",
        );
      else if (err instanceof ApiError && err.status === 0) setError("Cannot reach the daemon");
      else setError(`Pairing failed: ${messageOf(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // Pairing codes are single use: a failed attempt is reported and never retried automatically.
  async function submitRtc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    let invite: WireInvite;
    try {
      invite = parseInvite(inviteText);
    } catch (err) {
      setError(`Invite is not valid: ${messageOf(err)}`);
      setBusy(false);
      return;
    }
    let transport: RtcTransport | null = null;
    let token: string | null = null;
    try {
      transport = await createRtcTransport({ invite, auth: { kind: "pair", code: invite.code! } });
      const res = await transport.request("POST", "/pair", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: formatCode(invite.code!), name: cleanDeviceName(deviceName) || "This browser" }),
      });
      if (res.status !== 200) {
        const message =
          res.status === 400
            ? "Invalid or expired code"
            : res.status === 429
              ? "Too many attempts. Try again later."
              : `Pairing failed (${res.status})`;
        throw new ApiError(message, res.status);
      }
      let data: unknown;
      try {
        data = JSON.parse(res.body);
      } catch {
        throw new Error("Unexpected pairing response");
      }
      const d = data as { deviceId?: unknown; token?: unknown } | null;
      if (!d || typeof d.deviceId !== "string" || typeof d.token !== "string") throw new Error("Unexpected pairing response");
      setRtcIdentity({
        server: invite.server.replace(/\/+$/, ""),
        topic: invite.topic,
        stun: [...invite.stun],
        deviceId: d.deviceId,
        ...(invite.turn ? { turn: invite.turn } : {}),
      });
      token = d.token;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not join over WebRTC: ${messageOf(err)}`);
    } finally {
      transport?.close();
      setInviteText("");
      setBusy(false);
    }
    if (token !== null) await finish(token, true);
  }

  const tabId = (m: Mode) => `login-tab-${m}`;
  const panelId = (m: Mode) => `login-panel-${m}`;
  const nameField = (
    <>
      <Field><FieldLabel htmlFor="device-name">Device name</FieldLabel><Input
        id="device-name"
        type="text"
        maxLength={64}
        autoComplete="off"
        value={deviceName}
        onChange={(e) => setDeviceName(e.target.value)}
      /></Field>
    </>
  );

  return (
    <main className="mx-auto mt-[12vh] mb-0 max-w-[420px] px-4">
      <h1>OpenAg</h1>
      <p className="text-muted-foreground">On the computer running OpenAg, run <code>pnpm desk:open</code>. Or pair this device using a code from a trusted desk.</p>
      {joinInvite?.full && <p role="status">The host invited this browser to have Full access. Confirm the device name to continue. This link expires after five minutes and works once.</p>}
      {onCancel && <Button type="button" onClick={onCancel} disabled={busy}>Cancel and keep current access</Button>}
      <Tabs value={mode} onValueChange={value => switchMode(value as Mode)}>
      <TabsList aria-label="Sign-in method" className="w-full">
        {(["token", "pair", "rtc"] as const).map(m => <TabsTrigger key={m} value={m} id={tabId(m)} aria-controls={panelId(m)}>{m === "token" ? "Legacy token" : m === "pair" ? "Pair with a code" : "Join without VPN"}</TabsTrigger>)}
      </TabsList>

      {mode === "token" ? (
        <form
          className="pt-4"
          role="tabpanel"
          id={panelId("token")}
          aria-label="Sign in with an access token"
          onSubmit={submitToken}
        >
        <FieldGroup>
          <Field><FieldLabel htmlFor="token">Access token</FieldLabel><Input
            id="token"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          /></Field>
          {nameField}
          <Button type="submit" disabled={busy}>
            {busy ? "Checking..." : "Connect"}
          </Button>
          <ErrorLine error={error} />
        </FieldGroup></form>
      ) : mode === "pair" ? (
        <form
          className="pt-4"
          role="tabpanel"
          id={panelId("pair")}
          aria-label="Pair this browser with a code"
          onSubmit={submitPair}
        >
        <FieldGroup>
          <Field><FieldLabel htmlFor="pair-code">Pairing code</FieldLabel><Input
            id="pair-code"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            placeholder="XXXX-XXXX"
            required
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
          /></Field>
          {nameField}
          <Button type="submit" disabled={busy}>
            {busy ? "Pairing..." : "Pair"}
          </Button>
          <ErrorLine error={error} />
        </FieldGroup></form>
      ) : (
        <form
          className="pt-4"
          role="tabpanel"
          id={panelId("rtc")}
          aria-label="Join without VPN using an invite"
          onSubmit={submitRtc}
        >
        <FieldGroup>
          <Field><FieldLabel htmlFor="rtc-invite">Invite JSON</FieldLabel><Textarea
            id="rtc-invite"
            autoComplete="off"
            spellCheck={false}
            required
            placeholder='{"server":"...","topic":"...","stun":[],"code":"...","secret":"..."}'
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
          /></Field>
          <p className="text-muted-foreground">The invite is single use and expires in 5 minutes. Paste it here only.</p>
          {nameField}
          <Button type="submit" disabled={busy}>
            {busy ? "Joining..." : "Join"}
          </Button>
          <ErrorLine error={error} />
        </FieldGroup></form>
      )}
      </Tabs>
    </main>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null;
}
