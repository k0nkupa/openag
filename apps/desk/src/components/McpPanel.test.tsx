import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "../api";
import { McpPanel as Panel } from "./McpPanel";
import { AppLibraryProvider } from "../app-library";
const { subscribe } = vi.hoisted(() => ({ subscribe: () => () => {} }));
vi.mock("../stream", () => ({ useStream: () => ({ subscribe }) }));
function McpPanel({ api }: { api: Api }) { return <AppLibraryProvider api={api}><Panel api={api} /></AppLibraryProvider>; }

const status = {
  servers: [
    { id: "brave", transport: "stdio", state: "skipped", detail: "missing env BRAVE_API_KEY", toolCount: 0 },
    { id: "remote", transport: "http", state: "connected", toolCount: 2 },
  ],
  configPath: "/data/mcp.json",
};

function makeApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getAppLibrary: vi.fn(async () => ({ ...status, apps: [], entries: [], counts: {installed:2,ready:1}, machine:"Fixture", appsDir:"/data/apps" })),
    reloadMcp: vi.fn(async () => status),
    ...overrides,
  } as unknown as Api & { getAppLibrary: ReturnType<typeof vi.fn>; reloadMcp: ReturnType<typeof vi.fn> };
}

const flush = () => act(async () => { await Promise.resolve(); });

describe("McpPanel", () => {
  it("shows the read-only notice and each server's state, tool count and short detail", async () => {
    render(<McpPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText(/Servers are listed from mcp.json/)).toBeTruthy();
    expect(screen.getByText(/Unknown tools always ask for approval/)).toBeTruthy();
    expect(screen.getByText("brave")).toBeTruthy();
    expect(screen.getByText("Skipped")).toBeTruthy();
    expect(screen.getByText("missing env BRAVE_API_KEY")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("2 tools")).toBeTruthy();
  });

  it("has no controls that create or edit servers", async () => {
    render(<McpPanel api={makeApi()} />);
    await flush();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Advanced maintenance"]);
  });

  it("Reload calls the API and shows the new status", async () => {
    const api = makeApi({
      reloadMcp: vi.fn(async () => ({ servers: [], configPath: "/data/mcp.json" })),
    });
    render(<McpPanel api={api} />);
    await flush();
    api.getAppLibrary.mockResolvedValueOnce({servers:[],configPath:"/data/mcp.json",apps:[],entries:[],counts:{installed:0,ready:0},machine:"Fixture",appsDir:"/data/apps"});
    fireEvent.click(screen.getByRole("button", { name: "Advanced maintenance" }));
    fireEvent.click(screen.getByRole("button", { name: "Reconnect MCP" }));
    await flush();
    expect(api.reloadMcp).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No connectors configured.")).toBeTruthy();
  });

  it("shows a load error without crashing", async () => {
    const api = makeApi({ getAppLibrary: vi.fn(async () => Promise.reject(new Error("Cannot reach the daemon"))) });
    render(<McpPanel api={api} />);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Cannot reach the daemon");
  });
});
