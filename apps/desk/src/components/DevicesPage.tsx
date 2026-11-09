import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Separator } from "./ui/separator";
import { useState } from "react";
import type { Api, Whoami } from "../api";
import { DevicesPanel } from "./DevicesPanel";
import { OwnerPanel } from "./OwnerPanel";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";

export function DevicesPage({ api, onSignOut, identity = null, deviceNotice = null, onIdentityChange }: {
  api: Api;
  onSignOut: () => void;
  identity?: Whoami | null;
  deviceNotice?: string | null;
  onIdentityChange?: (who: Whoami) => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  // Revoke the saved device before clearing its local session; local sign-out still works offline.
  async function signOutHere() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const who = identity ?? await api.whoami();
      if (who.kind === "device") await api.revokeDevice(who.deviceId);
    } catch { /* local sign-out must remain available when the daemon is unreachable */ }
    onSignOut();
  }
  return <section className="flex min-w-0 flex-col gap-8" aria-labelledby="devices-title">
    <DevicesPanel api={api} onSignOut={onSignOut} identity={identity} onIdentityChange={onIdentityChange} />
    {deviceNotice && <Alert><AlertDescription>{deviceNotice}</AlertDescription></Alert>}
    <Separator /><div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1"><p className="m-0 text-sm font-medium">This session</p><p className="m-0 text-sm text-muted-foreground">{identity?.kind === "device" ? `Signed in as ${identity.name}${identity.access ? ` (${identity.access} access)` : ""}` : identity?.kind === "owner" ? "Signed in as owner." : "Signed in on this device."}</p></div>
      <Button variant="outline" disabled={signingOut} onClick={() => void signOutHere()}>{signingOut ? "Signing out…" : "Sign out"}</Button>
    </div>
    <Collapsible><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronDown data-icon="inline-start" />Access &amp; recovery</CollapsibleTrigger><CollapsibleContent className="pt-4"><OwnerPanel /></CollapsibleContent></Collapsible>
  </section>;
}
