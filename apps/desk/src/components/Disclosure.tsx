import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Button } from "./ui/button";

/** Shared disclosure treatment; retained children preserve existing editor state. */
export function Disclosure({ title, children, defaultOpen = false, className }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return <Collapsible defaultOpen={defaultOpen} className={className}>
    <CollapsibleTrigger render={<Button variant="ghost" />} className="h-auto w-full justify-start whitespace-normal text-left"><ChevronDown data-icon="inline-start" className="shrink-0 transition-transform in-aria-expanded:rotate-180 motion-reduce:transition-none" />{title}</CollapsibleTrigger>
    <CollapsibleContent keepMounted className="min-w-0 pt-3">{children}</CollapsibleContent>
  </Collapsible>;
}
