import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";

export const BotSettingsNavigation = createContext<{
  selected: string | null;
  select: (title: string | null) => void;
} | null>(null);

export function BotSettingRow({ title, icon: Icon, children, onOpenChange }: { title: string; icon: LucideIcon; children: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const navigation = useContext(BotSettingsNavigation);
  const active = navigation?.selected === title;
  const notifyOpen = useRef(onOpenChange);
  notifyOpen.current = onOpenChange;
  useEffect(() => {
    if (navigation) notifyOpen.current?.(active);
  }, [!!navigation, active]);
  if (navigation) return <Collapsible open={active} onOpenChange={open => navigation.select(open ? title : null)} className="[&:not(:first-child)]:border-t [&:not(:first-child)]:border-border">
    <CollapsibleTrigger render={<Button variant="ghost" className="h-auto min-h-11 w-full justify-start" />}>
      <Icon data-icon="inline-start" /><span>{title}</span><ChevronDown data-icon="inline-end" className="ml-auto in-aria-expanded:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent keepMounted>
      <div className="flex min-w-0 flex-col gap-4 border-t border-border p-4">{children}</div>
    </CollapsibleContent>
  </Collapsible>;
  return <Sheet onOpenChange={onOpenChange}>
    <div className="[&:not(:first-child)]:border-t [&:not(:first-child)]:border-border">
      <SheetTrigger render={<Button variant="ghost" className="h-auto min-h-11 w-full justify-start" />}>
        <Icon data-icon="inline-start" /><span>{title}</span><ChevronRight data-icon="inline-end" className="ml-auto transition-transform duration-150" />
      </SheetTrigger>
    </div>
    <SheetContent side="right" keepMounted className="overflow-y-auto">
      <SheetHeader><SheetTitle className="flex items-center gap-2"><Icon aria-hidden="true" className="size-4 shrink-0" />{title}</SheetTitle></SheetHeader>
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-6">{children}</div>
    </SheetContent>
  </Sheet>;
}
