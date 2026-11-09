import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Login } from "./Login";

const OWNER = "owner-secret-value-xyz";
const DEVICE = "device-token-abc";

function json(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init ?? {}));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function fill(label: string, value: string) {
  if (label === "Access token") fireEvent.click(screen.getByRole("tab", { name: "Legacy token" }));
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("Login", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("swaps an owner token for a device token and stores only the device token", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = stubFetch((url, init) => {
      if (url === "/whoami") return json(200, { kind: "owner" });
      if (url === "/devices" && init.method === "POST") {
        return json(201, { device: { id: "d1", name: "Mac browser" }, token: DEVICE }, {});
      }
      return json(404, { error: "nope" });
    });
    const onSignedIn = vi.fn();
    render(<Login notice={null} onSignedIn={onSignedIn} />);
    fill("Access token", OWNER);
    fill("Device name", "  Mac browser  ");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(DEVICE));
    const createCall = fetchMock.mock.calls.find(([u]) => u === "/devices");
    expect(JSON.parse(String((createCall?.[1] as RequestInit).body))).toEqual({ name: "Mac browser", access: "full" });

    const stored = setItem.mock.calls.map((c) => String(c[1]));
    expect(stored).toEqual([DEVICE]);
    expect(setItem.mock.calls.flat().join(" ")).not.toContain(OWNER);
    expect(fetchMock.mock.calls.map(([u]) => String(u)).join(" ")).not.toContain(OWNER);
    expect(document.body.textContent).not.toContain(OWNER);
  });

  it("stores nothing when minting the device token fails", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    stubFetch((url) => {
      if (url === "/whoami") return json(200, { kind: "owner" });
      return json(500, { error: "disk full" });
    });
    const onSignedIn = vi.fn();
    render(<Login notice={null} onSignedIn={onSignedIn} />);
    fill("Access token", OWNER);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Sign-in failed: disk full")).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("shows Wrong token on a 401 and stores nothing", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    stubFetch(() => json(401, { error: "unauthorized" }));
    render(<Login notice={null} onSignedIn={vi.fn()} />);
    fill("Access token", "bad");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Wrong token")).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("stores a pasted device token as is", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = stubFetch(() => json(200, { kind: "device", deviceId: "d2", name: "Phone" }));
    const onSignedIn = vi.fn();
    render(<Login notice={null} onSignedIn={onSignedIn} />);
    fill("Access token", DEVICE);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(DEVICE));
    expect(setItem).toHaveBeenCalledWith("openag-token", DEVICE);
    expect(fetchMock.mock.calls.some(([u]) => u === "/devices")).toBe(false);
  });

  it("pairs with a normalised code and stores the returned token", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = stubFetch((url) => {
      if (url === "/pair") return json(200, { deviceId: "d3", token: DEVICE });
      return json(404, {});
    });
    const onSignedIn = vi.fn();
    render(<Login notice={null} onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByRole("tab", { name: "Pair with a code" }));
    fill("Pairing code", "abcd 2345");
    fill("Device name", "Tablet");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(DEVICE));
    const call = fetchMock.mock.calls.find(([u]) => u === "/pair");
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ code: "ABCD-2345", name: "Tablet" });
    expect((call?.[1] as RequestInit).headers).not.toHaveProperty("authorization");
    expect(setItem).toHaveBeenCalledWith("openag-token", DEVICE);
  });

  it("shows the invalid-code message on 400", async () => {
    stubFetch(() => json(400, { error: "invalid or expired code" }));
    render(<Login notice={null} onSignedIn={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Pair with a code" }));
    fill("Pairing code", "ZZZZ-ZZZZ");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(await screen.findByText("Invalid or expired code")).toBeTruthy();
  });

  it("shows the Retry-After seconds on 429", async () => {
    stubFetch(() => json(429, { error: "too many attempts" }, { "Retry-After": "42" }));
    render(<Login notice={null} onSignedIn={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Pair with a code" }));
    fill("Pairing code", "ZZZZ-ZZZZ");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(await screen.findByText("Too many attempts. Try again in 42 seconds.")).toBeTruthy();
  });
});

describe("Login join link", () => {
  it("opens on the pairing tab with the code from #/join/<code> and removes it from the URL", () => {
    window.location.hash = "#/join/ABCD2345";
    render(<Login notice={null} onSignedIn={() => {}} />);
    expect((screen.getByLabelText(/pairing code/i) as HTMLInputElement).value).toBe("ABCD-2345");
    expect(window.location.hash).toBe("");
  });
});
