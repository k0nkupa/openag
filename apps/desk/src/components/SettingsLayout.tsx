import { useEffect, useRef, type ReactNode } from "react";
import { hrefFor, type Route } from "../route";
import { Icon } from "./Icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

type IconName = Parameters<typeof Icon>[0]["name"];

interface Item {
  id: string;
  label: string;
  icon: IconName;
  route: Route;
  /** True when `route` (the current one) belongs to this item. */
  active: (r: Route) => boolean;
}

const ITEMS: Item[] = [
  { id: "profile", label: "Profile", icon: "settings", route: { kind: "settings", section: "profile" }, active: r => r.kind === "settings" && r.section === "profile" },
  { id: "connectors", label: "Connectors", icon: "connectors", route: { kind: "connectors" }, active: (r) => r.kind === "connectors" },
  { id: "models", label: "Models", icon: "models", route: { kind: "settings", section: "models" }, active: (r) => r.kind === "settings" && r.section === "models" },
  { id: "proactive", label: "Proactive", icon: "bell", route: { kind: "settings", section: "proactive" }, active: (r) => r.kind === "settings" && r.section === "proactive" },
  { id: "devices", label: "Devices", icon: "computer", route: { kind: "settings", section: "devices" }, active: (r) => r.kind === "settings" && r.section === "devices" },
  { id: "server", label: "Server", icon: "server", route: { kind: "settings" }, active: (r) => r.kind === "settings" && !r.section },
];

/** The Settings area: its own sub-nav beside the page, as in the design. */
export function SettingsLayout({ route, children }: { route: Route; children: ReactNode }) {
  const navRef = useRef<HTMLElement>(null);
  const currentHref = hrefFor(route);
  useEffect(() => {
    const nav = navRef.current, current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const container = nav.getBoundingClientRect(), item = current.getBoundingClientRect();
    if (item.left < container.left || item.right > container.right) nav.scrollLeft += item.left - container.left - 16;
  }, [currentHref]);
  return (
    <div className="flex min-w-0 flex-col min-[860px]:min-h-full min-[860px]:flex-row">
      <nav ref={navRef} className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 min-[860px]:w-[220px] min-[860px]:flex-[0_0_220px] min-[860px]:flex-col min-[860px]:gap-1 min-[860px]:overflow-visible min-[860px]:border-r min-[860px]:border-b-0 min-[860px]:px-3 min-[860px]:py-4 min-[1080px]:w-48 min-[1080px]:flex-[0_0_192px] min-[1080px]:gap-2 min-[1080px]:py-6" aria-label="Settings">
        <div className="hidden">Settings</div>
        {ITEMS.map((it) => (
          <Button variant={it.active(route) ? "secondary" : "ghost"} role="link" nativeButton={false} render={<a href={hrefFor(it.route)} />} key={it.id} aria-current={it.active(route) ? "page" : undefined} className="shrink-0 justify-start no-underline">
            <Icon name={it.icon} />
            {it.label}
          </Button>
        ))}
      </nav>
      <div data-slot="settings-main" className="settings-main flex min-w-0 w-full max-w-[1120px] flex-col gap-6 p-8 [overflow-wrap:anywhere] max-[767px]:px-4 max-[767px]:py-6 min-[860px]:flex-1">{children}</div>
    </div>
  );
}

export function SettingsHeader({ id, title, description, action }: { id: string; title: string; description: string; action?: ReactNode }) {
  return <header data-slot="settings-header" className="flex flex-wrap items-start justify-between gap-4">
    <div className="flex min-w-0 flex-col gap-2">
      <h1 id={id} className="m-0 text-2xl leading-8 font-semibold tracking-tight">{title}</h1>
      <p className="m-0 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
    {action}
  </header>;
}

export function SettingsSection({ icon, title, description, children }: { icon: IconName; title: string; description?: string; children: ReactNode }) {
  return <Card role="region" aria-label={title}>
    <CardHeader>
      <CardTitle><h2 className="m-0 flex items-center gap-2 text-base font-medium"><Icon name={icon} />{title}</h2></CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-5">{children}</CardContent>
  </Card>;
}
