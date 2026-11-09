import { describe, expect, it } from "vitest";
import { hrefFor, parseHash } from "./route";

describe("parseHash", () => {
  it("parses room, inbox, settings and computer routes", () => {
    expect(parseHash("#/room/ops")).toEqual({ kind: "room", roomId: "ops" });
    expect(parseHash("#/inbox")).toEqual({ kind: "home" });
    expect(parseHash("#/settings")).toEqual({ kind: "settings" });
    expect(parseHash("#/settings/memory")).toEqual({ kind: "bots" });
    expect(parseHash("#/computer")).toEqual({ kind: "computer" });
    for (const kind of ["automations", "connectors", "bots", "ledger"] as const) {
      expect(parseHash(`#/${kind}`)).toEqual({ kind });
      expect(hrefFor({ kind })).toBe(`#/${kind}`);
    }
  });

  it("an empty, unknown or bare room hash is the home route, which names no room", () => {
    expect(parseHash("")).toEqual({ kind: "home" });
    expect(parseHash("#")).toEqual({ kind: "home" });
    expect(parseHash("#/nope")).toEqual({ kind: "home" });
    expect(parseHash("#/room")).toEqual({ kind: "home" });
    expect(hrefFor({ kind: "home" })).toBe("#/");
    expect(parseHash(hrefFor({ kind: "home" }))).toEqual({ kind: "home" });
  });

  it("decodes room ids and tolerates malformed escapes", () => {
    expect(parseHash("#/room/my%20room")).toEqual({ kind: "room", roomId: "my room" });
    expect(parseHash("#/room/%E0%A4%A")).toEqual({ kind: "room", roomId: "%E0%A4%A" });
  });
});

describe("hrefFor", () => {
  it("round-trips through parseHash", () => {
    const route = { kind: "room" as const, roomId: "a b/c" };
    expect(parseHash(hrefFor(route))).toEqual(route);
    expect(hrefFor({ kind: "home" })).toBe("#/");
  });
});
