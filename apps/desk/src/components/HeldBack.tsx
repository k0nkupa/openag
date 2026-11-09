import { Card, CardContent } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import { messageOf, type Api } from "../api";
import type { WakeDecision } from "../types";

const WHY: Record<string, string> = {
  budget: "budget used",
  active_hours: "outside active hours",
  dedupe: "repeat within the dedupe window",
  urgency: "below the urgency threshold",
  invalid: "unreadable output",
};

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** Pings the bot wanted to send that the wake filter held back today, with a way to say it got one wrong. */
export function HeldBack({ api }: { api: Api }) {
  const [rows, setRows] = useState<WakeDecision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getWakeDecisions(100).then(
      (r) => !cancelled && setRows(r.decisions),
      (err: unknown) => !cancelled && setError(messageOf(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function flag(id: number) {
    setBusy(id);
    setError(null);
    try {
      await api.sendWakeFeedback(id);
      setRows((prev) => prev?.map((d) => (d.id === id ? { ...d, feedback: "should_have_pinged" } : d)) ?? prev);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  const now = Date.now();
  const held = (rows ?? []).filter((d) => d.verdict === "ping" && d.decision !== "ping" && sameDay(d.ts, now));

  return (
    <div>
      {error && <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {rows === null && !error && <p className="text-muted-foreground">Loading...</p>}
      {rows !== null && held.length === 0 && <p className="text-muted-foreground">Nothing was held back today.</p>}
      {held.length > 0 && (
        <Card><CardContent><ul className="m-0 list-none p-0">
          {held.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3.5 border-b border-border p-5 last:border-b-0 max-[767px]:p-4">
              <div className="flex min-w-0 flex-[1_1_220px] flex-col">
                <span className="font-medium">
                  {d.botId} · {new Date(d.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="font-mono text-sm leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">
                  {d.reason}
                </span>
                <span className="font-mono text-sm leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">
                  ping → {d.decision}
                  {d.suppressedBy ? ` · ${WHY[d.suppressedBy] ?? d.suppressedBy}` : ""}
                </span>
              </div>
              {d.feedback === "should_have_pinged" ? (
                <span className="min-w-0 font-mono text-xs leading-[18px] text-muted-foreground" role="status">Noted</span>
              ) : (
                <Button type="button" disabled={busy === d.id} onClick={() => void flag(d.id)}>
                  Should have pinged
                </Button>
              )}
            </li>
          ))}
        </ul></CardContent></Card>
      )}
    </div>
  );
}
