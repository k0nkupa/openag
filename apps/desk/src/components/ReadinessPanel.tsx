import { Alert, AlertDescription } from "./ui/alert";
import { Check, ChevronDown } from "lucide-react";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Skeleton } from "./ui/skeleton";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import { ApiError, messageOf, type Api } from "../api";
import type { Readiness, ReadinessItem } from "../types";

const OWNER_ONLY = "Only a Full access device can enable recommended settings";
/** The only items "Enable recommended" switches on. Push, Slack, WebRTC and the liveness URL need your own setup. */
const RECOMMENDED = ["heartbeat", "reflection", "brief"];
const ERROR = "mt-1.5 mb-0 min-h-0 text-destructive";
const NOTICE = "mt-0 mb-2 text-(--warn) wrap-anywhere";

/** Headline for the panel: "ready", or how many required steps are left out of how many are required. */
export function headline(readiness: Readiness): string {
  const required = readiness.items.filter((i) => i.required);
  const left = required.filter((i) => !i.done).length;
  if (left === 0) return "Always-on: ready";
  return `Always-on: ${left} of ${required.length} required steps left`;
}

/** Required items first, then optional ones, each keeping the daemon's order. */
export function orderItems(items: ReadinessItem[]): { required: ReadinessItem[]; optional: ReadinessItem[] } {
  return {
    required: items.filter((i) => i.required),
    optional: items.filter((i) => !i.required),
  };
}

function ItemRow({ item }: { item: ReadinessItem }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {item.done ? <Check aria-label="Done" className="mt-0.5 size-4 shrink-0" /> : <Badge variant="attention">Needs setup</Badge>}
      <div className="flex min-w-0 flex-col gap-1"><strong className="text-sm font-medium">{item.title}</strong>
        <p className="m-0 text-sm text-muted-foreground">{item.detail}</p>
        {!item.done && <p className="m-0 text-sm text-muted-foreground">{item.how}</p>}
      </div>
    </li>
  );
}

export function ReadinessPanel({ api }: { api: Api }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [changed, setChanged] = useState<string[] | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getReadiness().then(
      (r) => {
        if (!cancelled) setReadiness(r);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function enableRecommended() {
    setApplying(true);
    setApplyError(null);
    setChanged(null);
    try {
      const result = await api.applyReadiness();
      setChanged(result.changed);
      try {
        setReadiness(await api.getReadiness());
      } catch {
        setReadiness(result.readiness);
      }
    } catch (err) {
      setApplyError(err instanceof ApiError && err.status === 403 ? OWNER_ONLY : messageOf(err));
    } finally {
      setApplying(false);
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive" className={ERROR}><AlertDescription>
        Could not load readiness: {loadError}
      </AlertDescription></Alert>
    );
  }
  if (readiness === null) return <Skeleton className="h-24 w-full" aria-label="Checking readiness" />;

  const { required, optional } = orderItems(readiness.items);
  const titleOf = (id: string) => readiness.items.find((i) => i.id === id)?.title ?? id;
  const showEnable = readiness.items.some((i) => RECOMMENDED.includes(i.id) && !i.done);

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 font-medium" role="status">
        {headline(readiness)}
      </p>

      <ul className="m-0 list-none divide-y divide-border p-0">{required.filter(item => !item.done).map(item => <ItemRow key={item.id} item={item} />)}</ul>
      <Collapsible><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronDown data-icon="inline-start" />Completed checks<Badge variant="secondary">{required.filter(item => item.done).length}</Badge></CollapsibleTrigger>
        <CollapsibleContent><ul className="m-0 list-none divide-y divide-border p-0">{required.filter(item => item.done).map(item => <ItemRow key={item.id} item={item} />)}</ul></CollapsibleContent>
      </Collapsible>
      {optional.length > 0 && <Collapsible><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronDown data-icon="inline-start" />Optional setup<Badge variant="secondary">{optional.length}</Badge></CollapsibleTrigger>
        <CollapsibleContent><ul className="m-0 list-none divide-y divide-border p-0">{optional.map(item => <ItemRow key={item.id} item={item} />)}</ul></CollapsibleContent>
      </Collapsible>}

      {showEnable && (
        <div>
          <p className="text-muted-foreground">
            Turns on the recommended heartbeat, nightly reflection and morning brief settings. Push, Slack, WebRTC and the
            liveness URL need your own setup.
          </p>
          <Button variant="outline" type="button" onClick={enableRecommended} disabled={applying}>
            {applying ? "Enabling..." : "Enable recommended"}
          </Button>
        </div>
      )}

      {changed !== null && (
        <p className={NOTICE} role="status">
          {changed.length === 0
            ? "Nothing to switch on. The recommended settings were already on."
            : `Switched on: ${changed.map(titleOf).join(", ")}.`}
        </p>
      )}
      {applyError && (
        <Alert variant="destructive" className={ERROR}><AlertDescription>
          {applyError}
        </AlertDescription></Alert>
      )}
    </div>
  );
}
