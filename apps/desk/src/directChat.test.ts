import { describe, expect, it, vi } from "vitest";
import type { Api } from "./api";
import { openDirectChat } from "./directChat";
import type { BotInfo, Room } from "./types";

const bot: BotInfo = { id: "solo", name: "Solo", runtime: "acp", model: null };
const room = (patch: Partial<Room>): Room => ({ id: "r", name: "R", leadBotId: "solo", members: ["solo"], ...patch });

function makeApi(rooms: Room[]) {
  return {
    listRooms: vi.fn(async () => ({ rooms })),
    createRoom: vi.fn(async (input: { id: string; name: string; members: string[]; kind?: string }) => ({ room: room({ id: input.id, kind: input.kind as Room["kind"] }), created: true })),
  } as unknown as Api & { createRoom: ReturnType<typeof vi.fn> };
}

describe("openDirectChat", () => {
  it("reuses the existing direct chat of the bot", async () => {
    const api = makeApi([room({ id: "chat-1", kind: "direct" })]);
    expect(await openDirectChat(api, bot)).toBe("chat-1");
    expect(api.createRoom).not.toHaveBeenCalled();
  });

  it("never mistakes a named one-bot room for a direct chat", async () => {
    const api = makeApi([room({ id: "notes", name: "Notes", kind: "room" })]);
    const id = await openDirectChat(api, bot);
    expect(id).toMatch(/^chat-[0-9a-f]{32}$/);
    expect(api.createRoom).toHaveBeenCalledWith({ id, name: "Solo", members: ["solo"], kind: "direct" });
  });

  it("treats a room from an older daemon (no kind) as a room", async () => {
    const api = makeApi([room({ id: "chat-old" })]);
    await openDirectChat(api, bot);
    expect(api.createRoom).toHaveBeenCalledTimes(1);
  });
});
