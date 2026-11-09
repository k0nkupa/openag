import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../api";
import type { AppInfo } from "../types";
import { AppsPanel as Panel } from "./AppsPanel";
import { AppLibraryProvider } from "../app-library";
const { subscribe } = vi.hoisted(() => ({ subscribe: () => () => {} }));
vi.mock("../stream", () => ({ useStream: () => ({ subscribe }) }));
function AppsPanel({ api }: { api: Api }) { return <AppLibraryProvider api={api}><Panel api={api} /></AppLibraryProvider>; }

const HASH = "0123456789abcdef0123456789abcdef";

const demo: AppInfo = {
  id: "demo",
  name: "Demo App",
  version: "1.2.0",
  description: "Lists a folder",
  hash: HASH,
  state: "disabled",
  tools: [
    {
      name: "app_demo_list",
      tool: "list",
      description: "List files",
      class: "read",
      argv: ["node", "list.js", "--all"],
      env: ["DEMO_TOKEN"],
      timeoutSec: 30,
    },
  ],
};

const enabledApp: AppInfo = { ...demo, id: "live", name: "Live App", state: "enabled" };
const invalidApp: AppInfo = { ...demo, id: "broken", name: "Broken App", state: "invalid", error: "manifest.json is not valid JSON", tools: [] };

function makeApi(overrides: Partial<Record<string, unknown>> = {}, apps: AppInfo[] = [demo, enabledApp]) {
  return {
    getAppLibrary: vi.fn(async () => ({ machine: "Fixture", apps, appsDir: "/data/apps", servers: [], entries: [], counts: {installed: apps.length, ready: 0} })),
    reloadApps: vi.fn(async () => ({ apps })),
    reviewApp: vi.fn(async (id: string) => ({ app: apps.find(app => app.id === id) })),
    enableApp: vi.fn(async (id: string) => { apps = apps.map(app => app.id === id ? {...app, state: "enabled"} : app); return {app: apps.find(app => app.id === id)}; }),
    disableApp: vi.fn(async (id: string) => { apps = apps.map(app => app.id === id ? {...app, state: "disabled"} : app); return {app: apps.find(app => app.id === id)}; }),
    ...overrides,
  } as unknown as Api & {
    getAppLibrary: ReturnType<typeof vi.fn>;
    reloadApps: ReturnType<typeof vi.fn>;
    enableApp: ReturnType<typeof vi.fn>;
    disableApp: ReturnType<typeof vi.fn>;
  };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

async function openReview(name = "Demo App") {
  fireEvent.click(screen.getByRole("button", { name: "Review and enable" }));
  await flush();
  return screen.getByRole("region", { name: `Review ${name}` });
}

describe("AppsPanel", () => {
  it("lists apps with state badges, ids, versions and tools", async () => {
    render(<AppsPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText("Demo App")).toBeTruthy();
    expect(screen.getByText("demo")).toBeTruthy();
    expect(screen.getAllByText("v1.2.0").length).toBe(2);
    expect(screen.getAllByText("Lists a folder").length).toBe(2);
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getAllByText("app_demo_list").length).toBe(2);
    expect(screen.getAllByText("List files").length).toBe(2);
    expect(screen.getAllByText("read").length).toBe(2);
    expect(screen.getByText(/Apps are folders you copy into/).textContent).toContain("/data/apps");
  });

  it("the review box shows the command, env names, time limit, whole-folder hash and warning", async () => {
    render(<AppsPanel api={makeApi()} />);
    await flush();
    const box = await openReview();
    expect(box.textContent).toContain("node list.js --all");
    expect(box.textContent).toContain("DEMO_TOKEN");
    expect(box.textContent).toContain("30s");
    expect(box.textContent).toContain(HASH.slice(0, 12));
    expect(box.textContent).toContain(HASH);
    expect(box.textContent).toContain("Enabling lets this app run code on this machine as you. Only enable apps you trust.");
  });

  it("keeps Enable disabled until the checkbox is ticked, then sends the reviewed hash", async () => {
    const api = makeApi();
    render(<AppsPanel api={api} />);
    await flush();
    const box = await openReview();
    const enable = screen.getByRole("button", { name: "Enable" }) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this app/ }));
    expect(enable.disabled).toBe(false);
    fireEvent.click(enable);
    await flush();
    expect(api.enableApp).toHaveBeenCalledWith("demo", HASH);
    expect(box).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Review Demo App" })).toBeNull();
    expect(screen.getAllByText("Enabled").length).toBe(2);
  });

  it("shows the owner-only message for a 403 on enable", async () => {
    const api = makeApi({ enableApp: vi.fn(async () => Promise.reject(new ApiError("forbidden", 403))) });
    render(<AppsPanel api={api} />);
    await flush();
    await openReview();
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this app/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Full access is required. Ask a trusted Full access device, or run pnpm desk:open on the daemon host.");
  });

  it("shows the server message and reload hint for a 409, and closes the review", async () => {
    const api = makeApi({
      enableApp: vi.fn(async () => Promise.reject(new ApiError("manifest changed since review", 409))),
    });
    render(<AppsPanel api={api} />);
    await flush();
    await openReview();
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this app/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("manifest changed since review Reload and review again.");
    expect(screen.queryByRole("region", { name: "Review Demo App" })).toBeNull();
  });

  it("Disable asks for confirmation before calling the API", async () => {
    const api = makeApi();
    render(<AppsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(api.disableApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm disable" }));
    await flush();
    expect(api.disableApp).toHaveBeenCalledWith("live");
    expect(screen.getAllByText("Disabled").length).toBe(2);
  });

  it("Reload replaces the list", async () => {
    const api = makeApi({}, [demo]);
    api.reloadApps.mockResolvedValueOnce({ apps: [{ ...invalidApp, id: "fresh", name: "Fresh App" }] });
    render(<AppsPanel api={api} />);
    await flush();
    expect(screen.getByText("Demo App")).toBeTruthy();
    api.getAppLibrary.mockResolvedValueOnce({machine:"Fixture", apps:[{...invalidApp,id:"fresh",name:"Fresh App"}],appsDir:"/data/apps",servers:[],entries:[],counts:{installed:1,ready:0}});
    fireEvent.click(screen.getByRole("button", { name: "Advanced maintenance" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload app folders" }));
    await flush();
    expect(api.reloadApps).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Demo App")).toBeNull();
    expect(screen.getByText("Fresh App")).toBeTruthy();
  });

  it("an invalid app shows its error and has no enable button", async () => {
    render(<AppsPanel api={makeApi({}, [invalidApp])} />);
    await flush();
    expect(screen.getByText("Invalid")).toBeTruthy();
    expect(screen.getByText("manifest.json is not valid JSON")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review and enable" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
  });

  it("renders manifest strings containing markup as inert text", async () => {
    const hostile: AppInfo = {
      ...demo,
      name: "<script>alert(1)</script>",
      description: "<img src=x onerror=alert(2)>",
      tools: [{ ...demo.tools[0], description: "<b>bold</b>", argv: ["<script>x</script>"], env: ["<i>E</i>"] }],
    };
    const { container } = render(<AppsPanel api={makeApi({}, [hostile])} />);
    await flush();
    await openReview("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(screen.getByText("<img src=x onerror=alert(2)>")).toBeTruthy();
  });

  it("shows the empty state with the apps folder", async () => {
    render(<AppsPanel api={makeApi({}, [])} />);
    await flush();
    expect(screen.getByText(/No apps found. Copy an app folder into/).textContent).toContain("/data/apps");
    expect(screen.getByText(/and press Reload./)).toBeTruthy();
  });

  it("shows a load error without crashing", async () => {
    const api = makeApi({ getAppLibrary: vi.fn(async () => Promise.reject(new Error("Cannot reach the daemon"))) });
    render(<AppsPanel api={api} />);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Cannot reach the daemon");
  });
});
