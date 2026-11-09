import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOwnerToken, getOwnerToken, setOwnerToken, subscribeOwnerToken } from "./ownerSession";

describe("ownerSession", () => {
  afterEach(() => {
    clearOwnerToken();
  });

  it("holds the token in memory and notifies subscribers on set and clear", () => {
    const cb = vi.fn();
    const off = subscribeOwnerToken(cb);
    expect(getOwnerToken()).toBeNull();
    setOwnerToken("owner-abc");
    expect(getOwnerToken()).toBe("owner-abc");
    expect(cb).toHaveBeenCalledTimes(1);
    clearOwnerToken();
    expect(getOwnerToken()).toBeNull();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setOwnerToken("again");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("ignores an empty token and does not notify on clearing when nothing is held", () => {
    const cb = vi.fn();
    const off = subscribeOwnerToken(cb);
    setOwnerToken("");
    clearOwnerToken();
    expect(getOwnerToken()).toBeNull();
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it("never touches browser storage", () => {
    const spies = [
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Document.prototype, "cookie", "set"),
    ];
    setOwnerToken("owner-abc");
    clearOwnerToken();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});
