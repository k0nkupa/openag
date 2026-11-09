import { Card, CardContent } from "./ui/card";
import { useState } from "react";
import { BookOpen, Puzzle, ShieldCheck } from "lucide-react";
import type { BotSettingSection } from "../route";
import type { Api } from "../api";
import type { BotInfo } from "../types";
import { BotEditor } from "./BotEditor";
import { BotSettingRow, BotSettingsNavigation } from "./BotSettingRow";
import { MemoryPage } from "./MemoryPage";
import { SkillsPanel } from "./SkillsPanel";
import { PermissionControl } from "./PermissionControl";
import type { StreamListener } from "../stream";

/** Reuse the bot editors inside the conversation panel, including their drafts. */
const settingTitles: Record<BotSettingSection, string> = {model: "Model and reasoning", instructions: "Instructions", memories: "Memories", skills: "Skills", permissions: "Permissions"};
export function BotSettings({ api, bot, roomId, canManage, subscribe, selectedSection, onSelectSection }: { api: Api; bot: BotInfo; roomId: string; canManage: boolean; subscribe?: (listener: StreamListener) => () => void; selectedSection?: BotSettingSection; onSelectSection?: (section?: BotSettingSection) => void }) {
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selected = onSelectSection ? selectedSection ? settingTitles[selectedSection] : null : localSelected;
  const select = (title: string | null) => { if (onSelectSection) onSelectSection((Object.keys(settingTitles) as BotSettingSection[]).find(section => settingTitles[section] === title)); else setLocalSelected(title); };
  return <BotSettingsNavigation value={{ selected, select }}>
    <div data-slot="bot-settings-detail" className="flex min-w-0 flex-col gap-4">
      <div>
        <BotEditor api={api} bot={bot} onSaved={() => {}}>
          <BotSettingRow title="Memories" icon={BookOpen}><MemoryPage api={api} bot={bot} /></BotSettingRow>
          <BotSettingRow title="Skills" icon={Puzzle}><SkillsPanel api={api} botId={bot.id} /></BotSettingRow>
        </BotEditor>
        <section className="mt-6" aria-label="Permissions"><Card className="gap-0 py-0"><CardContent className="px-0"><BotSettingRow title="Permissions" icon={ShieldCheck}><div className="p-4"><PermissionControl api={api} roomId={roomId} bots={[bot]} initialBotId={bot.id} canManage={canManage} subscribe={subscribe}/></div></BotSettingRow></CardContent></Card></section>
      </div>
    </div>
  </BotSettingsNavigation>;
}
