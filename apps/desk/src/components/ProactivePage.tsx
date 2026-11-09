import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { hrefFor, type ProactiveTab } from "../route";
import type { Api } from "../api";
import { HeldBack } from "./HeldBack";
import { NotificationsPanel } from "./NotificationsPanel";
import { ProactiveCard } from "./ProactiveCard";
import { ReflectionPanel } from "./ReflectionPanel";
import { SettingsHeader } from "./SettingsLayout";
import { SchedulePanel } from "./SchedulePanel";

export function ProactivePage({ api, tab = "schedule" }: { api: Api; tab?: ProactiveTab }) {
  return (
    <section data-slot="proactive-page" className="flex flex-col gap-5" aria-labelledby="proactive-title">
      <SettingsHeader id="proactive-title" title="Proactive" description="Choose when your agents check in, what wakes you and how you are notified." />
      <Tabs value={tab} onValueChange={value => { window.location.hash = hrefFor({kind: "settings", section: "proactive", tab: value as ProactiveTab}); }}><TabsList variant="line" aria-label="Proactive settings"><TabsTrigger value="schedule">Schedule</TabsTrigger><TabsTrigger value="reflection">Reflection</TabsTrigger><TabsTrigger value="notifications">Notifications</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
      <TabsContent value="schedule" keepMounted><SchedulePanel api={api} /></TabsContent>
      <TabsContent value="reflection" keepMounted><ReflectionPanel api={api} /></TabsContent>
      <TabsContent value="notifications" keepMounted>
      <ProactiveCard title="Phone notifications" description="Send phone notifications for approvals and important updates.">
        <NotificationsPanel api={api} />
      </ProactiveCard>
      </TabsContent><TabsContent value="history" keepMounted><ProactiveCard title="Held-back alerts" description="Review alerts that your notification rules held back.">
        <HeldBack api={api} />
      </ProactiveCard></TabsContent></Tabs>
    </section>
  );
}
