import {cn} from 'cn';
import {Icon} from './Icon';
import {PermissionAdoption} from './PermissionAdoption';
import {PermissionControl} from './PermissionControl';
import type {StreamListener} from '../stream';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "./ui/card";
import { setHideTechnicalActivity, useHideTechnicalActivity } from "../chat-display";
import { Switch } from "./ui/switch";
import { getTheme, setTheme, type Theme } from "../theme";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { buttonVariants } from "./ui/button";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsHeader, SettingsSection } from "./SettingsLayout";
import type { BackupStatus, ComputerStatus } from "../types";
import { messageOf, type Api } from "../api";
import type { Health } from "../types";
import { RtcPanel } from "./RtcPanel";
import { OpsPanel } from "./OpsPanel";
import { ReadinessPanel } from "./ReadinessPanel";

const listRow = "flex flex-wrap items-center gap-3.5 border-b border-border p-5 last:border-b-0 max-[767px]:p-4";
const listRowMain = "flex min-w-0 flex-[1_1_220px] flex-col";
const listRowSub = "text-sm leading-[1.5] text-muted-foreground [font-family:var(--mono)] [overflow-wrap:anywhere]";


export function SettingsView({ api,canManage=false,subscribe }: { api: Api;canManage?:boolean;subscribe?:(listener:StreamListener)=>()=>void }) {
  const [permissionActive,setPermissionActive]=useState(false);
  const hideTechnicalActivity = useHideTechnicalActivity();
  const [theme, updateTheme] = useState<Theme>(getTheme);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupStatus | null>(null);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getBackups().then((b) => !cancelled && setBackups(b), () => undefined);
    api.getComputer().then((c) => !cancelled && setComputer(c), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api.health().then(
      (h) => {
        if (!cancelled) setHealth(h);
      },
      (err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const lastBackup = backups?.last;
  // Tailscale addresses: a .ts.net name or an IP in 100.64.0.0/10 (carrier-grade NAT range Tailscale uses).
  const h = window.location.hostname;
  const ipv4 = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  const onThisComputer = h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  const onTailscale = h.endsWith(".ts.net") || (ipv4 !== null && Number(ipv4[1]) >= 64 && Number(ipv4[1]) <= 127);

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-labelledby="settings-title">
      <SettingsHeader id="settings-title" title="Server" description="Health, backups and access to this OpenAg server." />
      {error && <Alert variant="destructive"><AlertDescription>Could not check server health: {error}</AlertDescription></Alert>}
      <Card><CardContent><dl className="m-0 flex flex-wrap gap-x-10 gap-y-6" aria-label="Server summary">
        <div>
          <dt className="text-xs text-muted-foreground">Server</dt>
          <dd className="m-0 font-medium [overflow-wrap:anywhere]">{window.location.hostname}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last backup</dt>
          <dd className="m-0 font-medium [overflow-wrap:anywhere]">{lastBackup ? `${lastBackup.ok ? "" : "failed, "}${new Date(lastBackup.at).toLocaleString()}` : backups?.enabled === false ? "Off" : backups ? "No recorded run" : "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Computers</dt>
          <dd className="m-0 font-medium [overflow-wrap:anywhere]">{computer ? (computer.state === "running" ? "1 running" : "None running") : "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Daemon</dt>
          <dd className="m-0 font-medium [overflow-wrap:anywhere]">{health ? (health.ok ? `OK · sqlite-vec ${health.vec_version}` : "Not ready") : error ? "Unreachable" : "Checking..."}</dd>
        </div>
      </dl></CardContent></Card>

      <Card role="region" aria-label="Permissions">
        <CardHeader>
          <CardTitle><h2 className="flex items-center gap-2"><Icon name="shield"/>Permissions</h2></CardTitle>
          <CardDescription>{permissionActive?"New conversations only.":"Choose a mode to enable tools."}</CardDescription>
          {permissionActive&&<CardAction className="self-center"><PermissionControl api={api} canManage={canManage} subscribe={subscribe}/></CardAction>}
        </CardHeader>
        <CardContent className={cn(permissionActive&&"hidden")}><PermissionAdoption api={api} canManage={canManage} subscribe={subscribe} onActiveChange={setPermissionActive}/></CardContent>
      </Card>
      <Tabs defaultValue="overview">
        <TabsList variant="line" aria-label="Server settings">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" keepMounted><SettingsSection icon="bolt" title="Always-on readiness" description="Resolve outstanding items to keep your agents available."><ReadinessPanel key={lastBackup?.at ?? "initial"} api={api} /></SettingsSection></TabsContent>
        <TabsContent value="operations" keepMounted><OpsPanel api={api} onBackupsChange={setBackups} /></TabsContent>
        <TabsContent value="connection" keepMounted><div className="flex flex-col gap-6">
      <SettingsSection icon="server" title="How devices reach this server" description="This browser’s route is shown below. Other routes require administrator setup.">
        <Card className="gap-0 py-0"><CardContent className="px-0">
          <div className={listRow}>
            <div className={listRowMain}>
              <span className="font-medium">{onThisComputer ? "This computer" : "Home network (LAN)"}</span>
              <span className={listRowSub}>{onTailscale ? "LAN reachability has not been checked" : window.location.host}</span>
            </div>
            <Badge variant="outline">{onTailscale ? "Not checked" : "Current address"}</Badge>
          </div>
          <div className={listRow}>
            <div className={listRowMain}>
              <span className="font-medium">Tailscale</span>
              <span className={listRowSub}>{onTailscale ? window.location.host : "Reach it at the machine's ts.net name"}</span>
            </div>
            <Badge variant="outline">{onTailscale ? "Current address" : "Not checked"}</Badge>
          </div>
          <div className={listRow}>
            <div className={listRowMain}>
              <span className="font-medium">Cloudflare Tunnel</span>
              <span className={listRowSub}>Optional public ingress for webhooks. An administrator must configure the tunnel.</span>
            </div>
          </div>
        </CardContent></Card>

      </SettingsSection>

      <SettingsSection icon="computer" title="Direct join" description="Optional WebRTC access without a VPN."><RtcPanel api={api} /></SettingsSection>
      <SettingsSection icon="computer" title="Devices" description="Pair browsers and phones, review access and recover sign-in."><div><a href="#/settings/devices" className={buttonVariants({ variant: "outline" })}>Manage devices<ArrowRight data-icon="inline-end" /></a></div></SettingsSection>
        </div></TabsContent>
        <TabsContent value="appearance" keepMounted><SettingsSection icon="settings" title="Appearance" description="This preference applies to this browser only.">
          <FieldGroup><Field orientation="responsive"><FieldContent><FieldLabel id="theme-label">Theme</FieldLabel><FieldDescription>Follow your system, or choose a light or dark desk.</FieldDescription></FieldContent>
            <ToggleGroup aria-labelledby="theme-label" variant="outline" value={[theme]} onValueChange={values => { const next = values[0] as Theme | undefined; if (next) { setTheme(next); updateTheme(next); } }}>
              <ToggleGroupItem value="system">System</ToggleGroupItem><ToggleGroupItem value="light">Light</ToggleGroupItem><ToggleGroupItem value="dark">Dark</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="hide-technical-activity">Hide technical activity</FieldLabel><FieldDescription id="hide-technical-activity-help">Hide tool calls, results and turn markers in chats. Messages, errors and pending approvals stay visible. Details remain in Activity and Ledger.</FieldDescription></FieldContent><Switch id="hide-technical-activity" aria-describedby="hide-technical-activity-help" checked={hideTechnicalActivity} onCheckedChange={setHideTechnicalActivity} /></Field>
          </FieldGroup>
        </SettingsSection></TabsContent>
      </Tabs>
    </section>
  );
}
