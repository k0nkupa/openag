import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamProvider, useStream } from "./stream";
import type { RtcTransport } from "./rtc/transport";

function Probe({ onEvent }: { onEvent: (e: unknown) => void }) {
  const { status, subscribe } = useStream();
  subscribe({ onEvent: onEvent as never });
  return <p>status:{status}</p>;
}

describe("StreamProvider over WebRTC", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("subscribes through the transport with Bearer auth and never opens a WebSocket", async () => {
    const WebSocketSpy = vi.fn();
    vi.stubGlobal("WebSocket", WebSocketSpy);
    let deliver: ((e: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const transport = {
      state: "open",
      onClose: () => () => undefined,
      subscribe: vi.fn(async (_h: Record<string, string>, cb: (e: unknown) => void) => {
        deliver = cb;
        return unsubscribe;
      }),
    } as unknown as RtcTransport;
    const onEvent = vi.fn();
    const { unmount } = render(
      <StreamProvider token="tok" onAuthFailure={() => {}} rtcTransport={transport}>
        <Probe onEvent={onEvent} />
      </StreamProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("status:live")).toBeTruthy();
    expect((transport.subscribe as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual({ authorization: "Bearer tok" });
    expect(WebSocketSpy).not.toHaveBeenCalled();

    act(() => deliver!({ type: "message" }));
    expect(onEvent).toHaveBeenCalledWith({ type: "message" });

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("shows reconnecting when the subscribe fails", async () => {
    vi.useFakeTimers();
    const transport = {
      state: "open",
      onClose: () => () => undefined,
      subscribe: vi.fn(async () => {
        throw new Error("subscribe failed: http 503");
      }),
    } as unknown as RtcTransport;
    render(
      <StreamProvider token="tok" onAuthFailure={() => {}} rtcTransport={transport}>
        <Probe onEvent={() => {}} />
      </StreamProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("status:reconnecting")).toBeTruthy();
    vi.useRealTimers();
  });
});
