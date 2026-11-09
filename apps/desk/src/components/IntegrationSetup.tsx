import { Field, FieldLabel } from "./ui/field";
import { Checkbox } from "./ui/checkbox";
import { useEffect, useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { messageOf, type Api } from "../api";
import { useAppLibrary } from "../app-library";
import type { LibraryEntry, SetupReview } from "../types";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Disclosure } from "./Disclosure";
import { hrefFor } from "../route";
import { Textarea } from "./ui/textarea";

/** The desk reviews and detects. Only the owner-run command changes machine files/configuration. */
export function IntegrationSetup({ api, entry }: { api: Api; entry: LibraryEntry }) {
  const inventory = useAppLibrary();
  const [review, setReview] = useState<SetupReview | null>(null), [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [copied, setCopied] = useState(false), [checked, setChecked] = useState(false);
  useEffect(() => { if (inventory.error) { setReview(null); setAccepted(false); setCopied(false); setChecked(false); } }, [inventory.error]);
  async function open() {
    setBusy(true); setError(null); setAccepted(false); setCopied(false); setChecked(false); setReview(null);
    try { const next = await api.getSetupReview(entry.setupId!); if (!await inventory.refresh()) throw new Error("Current integration status is unavailable. Refresh the review when the connection is restored."); setReview(next); }
    catch (err) { setError(messageOf(err)); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setError(null); setChecked(false);
    try {
      if (review?.kind === "app") await api.reloadApps(); else await api.reloadMcp();
      const freshInventory = await inventory.refresh();
      if (!freshInventory) throw new Error("The installation check could not read current status. Refresh status before checking again.");
      if (review) { const fresh = await api.getSetupReview(review.id); setReview(fresh); setCopied(false); if (fresh.digest !== review.digest || fresh.machine !== review.machine || fresh.command !== review.command) { setAccepted(false); setError("The package or target changed. Review again before using the new command."); return; } }
      setChecked(true);
    } catch (err) { setReview(null); setAccepted(false); setCopied(false); setError(messageOf(err)); }
    finally { setBusy(false); }
  }
  async function copy(command: string) {
    try { await navigator.clipboard.writeText(command); setCopied(true); setError(null); }
    catch { setError("Clipboard access was unavailable. Select and copy the command below."); }
  }
  const changed = review?.installedDigest && review.installedDigest !== review.digest;
  return <section className="grid min-w-0 gap-4" aria-label="Reviewed local setup">
    <h3>{entry.installed ? "Local setup" : "Set up on this machine"}</h3>
    {!!entry.requirements.length && <section aria-label="Setup requirements"><h4>Requirements</h4><ul className="list-disc pl-5 text-sm text-muted-foreground">{entry.requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul></section>}
    {!review ? <><p className="text-muted-foreground">Review the source and machine access, then run the approved command on this machine.</p><Button variant="outline" disabled={busy} onClick={() => void open()}><Terminal data-icon="inline-start" />{busy ? "Loading review…" : entry.installed ? "Review local setup" : "Review setup"}</Button></> : <>
      <h4>1. Review package and access</h4>
      <dl className="grid gap-3.5 text-[14px]"><div className="grid grid-cols-[85px_minmax(0,1fr)] gap-4"><dt className="text-muted-foreground">Target</dt><dd className="[overflow-wrap:anywhere]">{review.machine}</dd></div><div className="grid grid-cols-[85px_minmax(0,1fr)] gap-4"><dt className="text-muted-foreground">Source</dt><dd className="[overflow-wrap:anywhere]">{review.source}</dd></div><div className="grid grid-cols-[85px_minmax(0,1fr)] gap-4"><dt className="text-muted-foreground">Version</dt><dd className="[overflow-wrap:anywhere]">{review.version}</dd></div></dl>
      <Disclosure title="Package details"><dl className="grid gap-3.5 text-sm"><div className="grid grid-cols-[85px_minmax(0,1fr)] gap-4"><dt className="text-muted-foreground">SHA-256</dt><dd className="[overflow-wrap:anywhere]"><code className="text-[13px] [overflow-wrap:anywhere]">{review.digest}</code></dd></div><div className="grid grid-cols-[85px_minmax(0,1fr)] gap-4"><dt className="text-muted-foreground">Install to</dt><dd className="[overflow-wrap:anywhere]"><code className="text-[13px] [overflow-wrap:anywhere]">{review.destination}</code></dd></div></dl></Disclosure>
      <p className="text-muted-foreground">{review.access}</p>
      {changed && <Alert variant="destructive"><AlertTitle>A different package is already present</AlertTitle><AlertDescription>Local setup will refuse to overwrite it. Existing files and user data are preserved. Review the detected installation separately.</AlertDescription></Alert>}
      <Field orientation="horizontal"><Checkbox id={`setup-review-${entry.id}`} disabled={busy || !!inventory.error} checked={accepted} onCheckedChange={checked => { setAccepted(checked); setCopied(false); }} /><FieldLabel className="min-h-11" htmlFor={`setup-review-${entry.id}`}>I reviewed this source, digest and machine access.</FieldLabel></Field>
      {accepted && <div className="grid min-w-0 gap-3">
        <h4>2. Run the command locally</h4>
        <Label htmlFor={`setup-command-${entry.setupId}`}>Run this on {review.machine}</Label>
        <Textarea className="font-mono leading-[1.6] [overflow-wrap:anywhere]" id={`setup-command-${entry.setupId}`} value={review.command} readOnly rows={5} spellCheck={false} />
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !!changed || !!inventory.error} onClick={() => void copy(review.command)}>{copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? "Copied" : "Copy setup command"}</Button><Button variant="outline" disabled={busy} onClick={() => void open()}>Refresh review</Button></div>
        <p className="text-muted-foreground">Run in a terminal on the target machine. The command checks this package’s digest and preserves a different existing installation.</p>
        <h4>3. Check installation</h4>
        {review.kind === "mcp" && <p className="text-muted-foreground">Checking reloads the configured MCP servers to perform their handshakes. It does not edit their configuration.</p>}
        <Button disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : review.kind === "app" ? "Reload and check installation" : "Reconnect and check installation"}</Button>
        {checked && <p className="text-muted-foreground" role="status">{entry.state === "ready" ? "The daemon reports this runtime ready. Bot approval rules are unchanged." : entry.installed ? entry.kind === "app" ? "Installation detected. The App still needs its fresh Review and enable step." : entry.state === "paused" ? "The connector is paused. Run the reviewed local setup command to resume it, then check again." : "Package or configuration detected. Resolve the current connector status above and check again." : "The daemon has not detected this installation. Run the local command and check again."}</p>}
        {checked && entry.installed && <Button nativeButton={false} render={<a href={hrefFor({kind: "connectors", integrationId: entry.id})} />}>Manage connection</Button>}
        <Disclosure title="Rollback and disable">
        {entry.installed && review.disableCommand && review.configurationDigest !== "absent" && <div className="mt-3 grid min-w-0 gap-3"><Label htmlFor={`disable-command-${entry.setupId}`}>Rollback: disable this MCP connector locally</Label><Textarea className="font-mono leading-[1.6] [overflow-wrap:anywhere]" id={`disable-command-${entry.setupId}`} value={review.disableCommand} readOnly rows={4} spellCheck={false} /><p className="text-muted-foreground">Refresh the review after setup to get the current configuration digest. Run the disable command, then reload MCP. It preserves installed code, unrelated connections and user data.</p></div>}
        {review.kind === "app" && <p className="text-muted-foreground">Rollback: use Disable on the detected App. This removes availability without deleting its code or data.</p>}
        </Disclosure>
      </div>}
    </>}
    {error && <Alert variant="destructive"><AlertTitle>Setup needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </section>;
}
