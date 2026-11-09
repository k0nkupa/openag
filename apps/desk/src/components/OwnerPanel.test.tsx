import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerPanel } from "./OwnerPanel";
import { clearOwnerToken, getOwnerToken } from "../ownerSession";

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function submit(token: string) {
  const legacy = screen.getByText("Legacy owner token");
  if (!legacy.closest("details")?.open) fireEvent.click(legacy);
  const input = screen.getByLabelText("Owner token") as HTMLInputElement;
  fireEvent.change(input, { target: { value: token } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  });
  return input;
}

describe("OwnerPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOwnerToken();
  });

  it("starts locked and unlocks with the owner token, clearing the input", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { kind: "owner" })));
    render(<OwnerPanel />);
    expect(screen.getByText("Owner actions: locked")).toBeTruthy();
    const input = await submit("owner-123");
    expect(getOwnerToken()).toBe("owner-123");
    expect(input.value).toBe("");
    expect(await screen.findByText("Owner actions: unlocked")).toBeTruthy();
  });

  it("rejects a wrong token without holding it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(401, { error: "unauthorized" })));
    render(<OwnerPanel />);
    const input = await submit("nope");
    expect(getOwnerToken()).toBeNull();
    expect(input.value).toBe("");
    expect(await screen.findByText("That is not the owner token")).toBeTruthy();
  });

  it("rejects a device token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { kind: "device", deviceId: "d1", name: "Mac" })));
    render(<OwnerPanel />);
    await submit("device-token");
    expect(getOwnerToken()).toBeNull();
    expect(await screen.findByText("That is a device token, not the owner token")).toBeTruthy();
  });

  it("locks again on Lock", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { kind: "owner" })));
    render(<OwnerPanel />);
    await submit("owner-123");
    await screen.findByText("Owner actions: unlocked");
    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    expect(getOwnerToken()).toBeNull();
    expect(screen.getByText("Owner actions: locked")).toBeTruthy();
  });
});
