import { EvidenceBlock } from "./EvidenceBlock";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { messageOf, type Api } from "../api";
import type { ResultQuery, SavedResult } from "../types";
import { useStream } from "../stream";
import { hrefFor } from "../route";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { Alert, AlertDescription } from "./ui/alert";

export function ResultPreview({
  api,
  initial,
}: {
  api: Api;
  initial: SavedResult;
}) {
  const [version, setVersion] = useState(initial.version);
  const [detail, setDetail] = useState<{
    result: SavedResult;
    content: string;
  }>();
  const [versions, setVersions] = useState<SavedResult[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError(undefined);
    void api
      .getResult(initial.id, version)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      });
    return () => {
      active = false;
    };
  }, [api, initial.id, version]);
  useEffect(() => {
    let active = true;
    void api
      .getResultVersions(initial.id)
      .then((page) => {
        if (active) {
          setVersions(page.results);
          setCursor(page.nextCursor);
        }
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      });
    return () => {
      active = false;
    };
  }, [api, initial.id]);
  async function moreVersions() {
    if (cursor === null || busy) return;
    setBusy(true);
    try {
      const page = await api.getResultVersions(initial.id, cursor);
      setVersions((old) => [...old, ...page.results]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const blob = await api.downloadResult(
          detail.result.id,
          detail.result.version,
        ),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = detail.result.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Proposed content</Badge>
        <Badge variant="secondary">{detail?.result.kind ?? initial.kind}</Badge>
        <span>Version {version}</span>
      </div>
      <p className="text-muted-foreground">
        Saved content is not proof that an action ran. Review linked activity
        for execution results.
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Result versions">
        {versions.map((item) => (
          <Button
            key={item.version}
            size="sm"
            variant={version === item.version ? "secondary" : "outline"}
            onClick={() => setVersion(item.version)}
          >
            Version {item.version}
          </Button>
        ))}
        {cursor !== null && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void moreVersions()}
          >
            Older versions
          </Button>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {detail ? (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 break-all">
            <dt>File</dt>
            <dd>{detail.result.name}</dd>
            <dt>Author</dt>
            <dd>{detail.result.botId}</dd>
            <dt>Room</dt>
            <dd>{detail.result.roomId}</dd>
            <dt>Work</dt>
            <dd>
              {detail.result.origin==='investigation'?'Investigation result; no Work was created':detail.result.workId ? <a className="underline" href={hrefFor({kind:"work",workId:detail.result.workId})}>{detail.result.workId}</a> : "Conversation result"}
            </dd>
            <dt>Turn</dt>
            <dd>{detail.result.turnId}</dd>
            <dt>Origin</dt>
            <dd>{detail.result.origin==='investigation'?'Daemon investigation · '+detail.result.investigationId:detail.result.toolCallId}</dd>
            <dt>Saved</dt>
            <dd>{new Date(detail.result.createdAt).toLocaleString()}</dd>
          </dl>
          <EvidenceBlock className="max-h-[50dvh]">
            {detail.content}
          </EvidenceBlock>
          <Button
            variant="outline"
            disabled={busy}
            className="min-h-11 h-auto max-w-full whitespace-normal break-all"
            onClick={() => void download()}
          >
            <Download data-icon="inline-start" />
            Download {detail.result.name}
          </Button>
        </>
      ) : (
        !error && <p role="status">Loading saved result…</p>
      )}
    </div>
  );
}

export function ResultsPanel({
  api,
  workId,
  roomId,
  botId,
}: { api: Api } & Pick<ResultQuery, "workId" | "roomId" | "botId">) {
  const [rows, setRows] = useState<SavedResult[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<SavedResult | null>(null);
  const { subscribe } = useStream();
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const page = await api.listResults({ workId, roomId, botId });
      if (current === request.current) {
        setRows(page.results);
        setCursor(page.nextCursor);
        setError(undefined);
      }
    } catch (err) {
      if (current === request.current) setError(messageOf(err));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [api, workId, roomId, botId]);
  useEffect(() => {
    setRows([]);
    setSelected(null);
    setError(undefined);
    setLoading(true);
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe({
      onOpen: () => void refresh(),
      onEvent: (event) => {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : {};
        if (
          event.type !== "result_saved" ||
          (roomId && event.roomId !== roomId) ||
          (botId && event.actor !== botId) ||
          (workId && payload.workId !== workId)
        )
          return;
        if (timer === undefined)
          timer = setTimeout(() => {
            timer = undefined;
            void refresh();
          }, 100);
      },
    });
    return () => {
      ++request.current;
      clearTimeout(timer);
      off();
    };
  }, [refresh, subscribe, roomId, botId, workId]);
  async function more() {
    if (cursor === null || loading) return;
    setLoading(true);
    const current = ++request.current;
    try {
      const page = await api.listResults({
        workId,
        roomId,
        botId,
        before: cursor,
      });
      if (current !== request.current) return;
      setRows((old) => [
        ...old,
        ...page.results.filter((item) => !old.some((r) => r.id === item.id)),
      ]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (current === request.current) setError(messageOf(err));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  return (
    <Sheet
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) setSelected(null);
      }}
    >
      <section
        className="flex min-w-0 flex-col gap-3"
        aria-label="Saved results"
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                Retry saved results
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {loading && !rows.length ? (
          <p role="status">Loading results…</p>
        ) : (
          !rows.length &&
          !error && (
            <p className="text-sm text-muted-foreground">
              No saved results yet. Input attachments stay in the conversation.
            </p>
          )
        )}
        {rows.map((item) => (
          <Button
            key={item.id}
            variant="outline"
            className="h-auto w-full justify-start gap-3 whitespace-normal p-3 text-left"
            onClick={() => setSelected(item)}
          >
            <FileText data-icon="inline-start" />
            <span className="min-w-0 break-all">
              {item.name}
              <small className="block text-muted-foreground">
                {item.botId} · {item.roomId} · v{item.version} · Proposed
              </small>
            </span>
          </Button>
        ))}
        {cursor !== null && (
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void more()}
          >
            More results
          </Button>
        )}
      </section>
      <SheetContent size="wide" className="overflow-auto">
        <SheetHeader>
          <SheetTitle className="break-all">
            {selected?.name ?? "Saved result"}
          </SheetTitle>
          <SheetDescription>Saved versions and source details</SheetDescription>
        </SheetHeader>
        {selected && (
          <ResultPreview key={selected.id} api={api} initial={selected} />
        )}
      </SheetContent>
    </Sheet>
  );
}

export function SavedResultButton({
  api,
  id,
  version,
  name,
}: {
  api: Api;
  id: string;
  version: number;
  name: string;
}) {
  const [open, setOpen] = useState(false),
    [detail, setDetail] = useState<{ result: SavedResult; content: string }>(),
    [error, setError] = useState<string>();
  async function show() {
    setOpen(true);
    setError(undefined);
    try {
      setDetail(await api.getResult(id, version));
    } catch (err) {
      setError(messageOf(err));
    }
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        className="min-h-11 h-auto max-w-full whitespace-normal break-all text-left"
        onClick={() => void show()}
      >
        <FileText data-icon="inline-start" />
        Open {name} · v{version}
      </Button>
      <SheetContent size="wide" className="overflow-auto">
        <SheetHeader>
          <SheetTitle className="break-all">{name}</SheetTitle>
          <SheetDescription>Saved result and source details</SheetDescription>
        </SheetHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : detail ? (
          <ResultPreview
            key={`${detail.result.id}:${detail.result.version}`}
            api={api}
            initial={detail.result}
          />
        ) : (
          <p className="p-4" role="status">
            Loading saved result…
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
