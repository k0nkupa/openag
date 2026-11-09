import { useEffect, useRef, useState } from "react";
import { messageOf, type Api } from "./api";
import { useStream } from "./stream";
import { isVisibleWork } from "./work-visibility";
import type { WorkItem, WorkQuery } from "./types";

/** One reader owns refresh/paging for a scope; stream bursts queue one subsequent refresh. */
export function useWorkList(api: Api, query: WorkQuery, enabled = true) {
  const key = JSON.stringify(query);
  const { subscribe } = useStream();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const controls = useRef({ refresh: () => {}, more: () => {} });
  useEffect(() => {
    let active = true,
      fetching = false,
      queued = false,
      pages = 1,
      next: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scope = JSON.parse(key) as WorkQuery;
    setItems([]);
    setCursor(null);
    setError(undefined);
    setLoading(enabled);
    if (!enabled) {
      controls.current = { refresh: () => {}, more: () => {} };
      return;
    }
    const schedule = () => {
      if (timer === undefined)
        timer = setTimeout(
          () => {
            timer = undefined;
            void load();
          },
          Math.max(750, pages * 500),
        );
    };
    async function load() {
      if (fetching) {
        queued = true;
        return;
      }
      fetching = true;
      setLoading(true);
      try {
        const rows: WorkItem[] = [];
        let before: number | undefined;
        for (let page = 0; page < pages; page++) {
          const result = await api.listWork({ ...scope, limit: 20, before });
          if (!active) return;
          rows.push(...result.work);
          next = result.nextCursor;
          if (next === null) break;
          before = next;
        }
        if (active) {
          setItems([...new Map(rows.map((item) => [item.id, item])).values()]);
          setCursor(next);
          setError(undefined);
        }
      } catch (err) {
        if (active) setError(messageOf(err));
      } finally {
        fetching = false;
        if (active) {
          setLoading(false);
          if (queued) {
            queued = false;
            schedule();
          }
        }
      }
    }
    controls.current = {
      refresh: () => void load(),
      more: () => {
        if (!fetching && next !== null) {
          pages++;
          void load();
        }
      },
    };
    void load();
    const off = subscribe({
      onOpen: () => void load(),
      onEvent: (event) => {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : {};
        if (
          event.type !== "work_updated" ||
          (scope.roomId && event.roomId !== scope.roomId) ||
          (scope.botId && event.actor !== scope.botId) ||
          (scope.parentId && payload.parentId !== scope.parentId)
        )
          return;
        if (fetching) queued = true;
        else schedule();
      },
    });
    return () => {
      active = false;
      clearTimeout(timer);
      off();
      controls.current = { refresh: () => {}, more: () => {} };
    };
  }, [api, key, enabled, subscribe]);
  return {
    items: items.filter(isVisibleWork),
    cursor,
    loading,
    error,
    refresh: () => controls.current.refresh(),
    more: () => controls.current.more(),
  };
}

/** Selection is independent of the current list/filter/page. */
export function useWorkItem(api: Api, id?: string) {
  const { subscribe } = useStream();
  const [item, setItem] = useState<WorkItem>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const controls = useRef({
    refresh: () => {},
    apply: (_item: WorkItem) => {},
  });
  useEffect(() => {
    let active = true,
      fetching = false,
      queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setItem(undefined);
    setError(undefined);
    setLoading(!!id);
    if (!id) {
      controls.current = { refresh: () => {}, apply: () => {} };
      return;
    }
    async function load() {
      if (fetching) {
        queued = true;
        return;
      }
      fetching = true;
      try {
        const result = await api.getWork(id!);
        if (active) {
          setItem((previous) =>
            previous?.id === result.work.id &&
            previous.revision > result.work.revision
              ? previous
              : result.work,
          );
          setError(undefined);
        }
      } catch (err) {
        if (active) setError(messageOf(err));
      } finally {
        fetching = false;
        if (active) {
          setLoading(false);
          if (queued) {
            queued = false;
            schedule();
          }
        }
      }
    }
    function schedule() {
      if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          void load();
        }, 500);
    }
    controls.current = {
      refresh: () => void load(),
      apply: (value) => {
        if (active && value.id === id)
          setItem((previous) =>
            previous?.id === value.id && previous.revision > value.revision
              ? previous
              : value,
          );
      },
    };
    void load();
    const off = subscribe({
      onOpen: () => void load(),
      onEvent: (event) => {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : {};
        if (event.type === "work_updated" && payload.workId === id) {
          if (fetching) queued = true;
          else schedule();
        }
      },
    });
    return () => {
      active = false;
      clearTimeout(timer);
      off();
      controls.current = { refresh: () => {}, apply: () => {} };
    };
  }, [api, id, subscribe]);
  return {
    item: item?.id === id ? item : undefined,
    error,
    loading,
    refresh: () => controls.current.refresh(),
    apply: (value: WorkItem) => controls.current.apply(value),
  };
}
