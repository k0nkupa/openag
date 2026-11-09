import type { ReactNode } from "react";
import type { Route } from "../route";
import type { Api } from "../api";
import { AutomationsPanel } from "./AutomationsPanel";
import { InstalledConnections } from "./AppLibraryPage";
import { SlackPanel } from "./SlackPanel";

import { SettingsHeader, SettingsSection } from "./SettingsLayout";

function Page({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-6" aria-labelledby={id}>
      <SettingsHeader id={id} title={title} description={intro} />
      {children}
    </section>
  );
}

export function AutomationsView({ api, route }: { api: Api; route?: Extract<Route, {kind: "automations"}> }) {
  return <section className="mx-auto flex w-full min-w-0 max-w-[1120px] flex-col gap-6 p-8 max-[767px]:px-4 max-[767px]:py-6" aria-labelledby="automations-title"><AutomationsPanel api={api} route={route} /></section>;
}

export function ConnectorsView({ api, integrationId }: { api: Api; integrationId?: string }) {
  return (
    <Page id="connectors-title" title="Connectors" intro="Manage the connections already added to this machine.">
      <SettingsSection icon="connectors" title="Installed connections" description="Review available services and manage their access."><InstalledConnections api={api} integrationId={integrationId} /></SettingsSection>
      <SettingsSection icon="bell" title="Slack" description="Connect one Slack channel to your workspace.">
        <SlackPanel api={api} />
      </SettingsSection>
    </Page>
  );
}
