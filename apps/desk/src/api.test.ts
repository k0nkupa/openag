import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./api";

const TOKEN = "super-secret-token-123";

function respond(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createApi reflection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /reflection and POSTs /reflection/run with Bearer auth", async () => {
    const fetchMock = vi.fn(async () => respond(202, { started: true }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.getReflection();
    await api.runReflection();
    const [getPath, getInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [postPath, postInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(getPath).toBe("/reflection");
    expect(getInit.method).toBe("GET");
    expect((getInit.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(postPath).toBe("/reflection/run");
    expect(postInit.method).toBe("POST");
  });

  it("maps a 409 from a run already in progress to ApiError with the server message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(409, { error: "reflection already running" })));
    const err = await createApi(TOKEN, () => {}).runReflection().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("reflection already running");
  });
});

describe("createApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the Bearer header on authed calls and not on health", async () => {
    const fetchMock = vi.fn(async () => respond(200, { approvals: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.listPending();
    await api.health();
    const [pendingPath, pendingInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [healthPath, healthInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(pendingPath).toBe("/approvals?status=pending");
    expect((pendingInit.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(healthPath).toBe("/health");
    expect((healthInit.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("encodes room ids and posts message text as JSON", async () => {
    const fetchMock = vi.fn(async () => respond(202, {}));
    vi.stubGlobal("fetch", fetchMock);
    await createApi(TOKEN, () => {}).sendMessage("a b", "hello");
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/rooms/a%20b/messages");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ text: "hello" }));
  });

  it("calls onUnauthorized on 401 and throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(401, { error: "unauthorized" })));
    const onUnauthorized = vi.fn();
    const err = await createApi(TOKEN, onUnauthorized).listRooms().catch((e: unknown) => e);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it("surfaces the server error text and never includes the token in messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(409, { error: "approval already decided" })));
    const err = await createApi(TOKEN, () => {}).decide("ap1", { kind: "accept" }).catch((e: unknown) => e);
    expect((err as ApiError).message).toBe("approval already decided");
    expect((err as ApiError).status).toBe(409);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("calls the takeover routes with Bearer auth and maps 409 to ApiError", async () => {
    const fetchMock = vi.fn(async () => respond(200, { active: false }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.getTakeover();
    await api.takeControl();
    await api.handBack();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([p]) => p)).toEqual(["/computer/takeover", "/computer/takeover", "/computer/handback"]);
    expect(calls.map(([, i]) => i.method)).toEqual(["GET", "POST", "POST"]);
    for (const [, init] of calls) {
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    }

    vi.stubGlobal("fetch", vi.fn(async () => respond(409, { error: "held by another device" })));
    const err = await createApi(TOKEN, () => {}).takeControl().catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(409);
    expect((err as Error).message).toBe("held by another device");
  });

  it("reports an unreachable daemon without leaking the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError(`failed to fetch with ${TOKEN}`);
    }));
    const err = await createApi(TOKEN, () => {}).listBots().catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(0);
    expect((err as Error).message).toBe("Cannot reach the daemon");
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe("createApi skills", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the skill list and one skill with encoded path segments and Bearer auth", async () => {
    const fetchMock = vi.fn(async () => respond(200, { skills: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.listSkills("boss/1");
    await api.getSkill("boss/1", "a b/c");
    const [listPath, listInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [getPath, getInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(listPath).toBe("/bots/boss%2F1/skills");
    expect(listInit.method).toBe("GET");
    expect((listInit.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(getPath).toBe("/bots/boss%2F1/skills/a%20b%2Fc");
    expect(getInit.method).toBe("GET");
  });

  it("maps a 404 for an unknown skill to ApiError with the server message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(404, { error: "skill not found" })));
    const err = await createApi(TOKEN, () => {}).getSkill("boss", "missing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("skill not found");
  });
});

describe("createApi automations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the one-time secret from create and omits it when absent", async () => {
    const auto = { id: "a1", name: "Hook" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(201, { automation: auto, secret: "generated-secret-1" }))
      .mockResolvedValueOnce(respond(201, { automation: auto }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    const withSecret = await api.createAutomation({ name: "Hook", botId: "boss", prompt: "p", triggerKind: "webhook" });
    const without = await api.createAutomation({ name: "Hook", botId: "boss", prompt: "p", triggerKind: "github", hookEvents: ["push"], secret: "12345678" });
    expect(withSecret.secret).toBe("generated-secret-1");
    expect(without.secret).toBeUndefined();
    const [path, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(path).toBe("/automations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ triggerKind: "github", hookEvents: ["push"], secret: "12345678" });
  });

  it("PUTs an automation by encoded id and rotates a webhook secret with POST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, { automation: { id: "a/1" } }))
      .mockResolvedValueOnce(respond(200, { secret: "rotated-secret" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.updateAutomation("a/1", { enabled: false });
    const rotated = await api.rotateAutomationSecret("a/1");
    const [patchPath, patchInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [rotPath, rotInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(patchPath).toBe("/automations/a%2F1");
    expect(patchInit.method).toBe("PUT");
    expect(rotPath).toBe("/automations/a%2F1/secret");
    expect(rotInit.method).toBe("POST");
    expect((rotInit.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(rotated.secret).toBe("rotated-secret");
  });

  it("sends the github_poll create body with the token and PUTs an update without pollToken", async () => {
    const auto = { id: "p1", name: "Poll" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(201, { automation: auto }))
      .mockResolvedValueOnce(respond(200, { automation: auto }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    const created = await api.createAutomation({
      name: "Poll",
      botId: "boss",
      prompt: "p",
      triggerKind: "github_poll",
      pollRepo: "owner/name",
      pollEveryMinutes: 15,
      pollToken: "ghp_0123456789abcdef",
      hookEvents: ["issues", "pull_request"],
    });
    await api.updateAutomation("p1", { pollRepo: "owner/other", pollEveryMinutes: 60 });
    expect(created.secret).toBeUndefined();
    const [createPath, createInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(createPath).toBe("/automations");
    expect(JSON.parse(createInit.body as string)).toEqual({
      name: "Poll",
      botId: "boss",
      prompt: "p",
      triggerKind: "github_poll",
      pollRepo: "owner/name",
      pollEveryMinutes: 15,
      pollToken: "ghp_0123456789abcdef",
      hookEvents: ["issues", "pull_request"],
    });
    const [, patchInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(patchInit.body as string)).not.toHaveProperty("pollToken");
  });

  it("surfaces a rotate error from the server message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(400, { error: "rotate is only for webhook automations" })));
    const err = await createApi(TOKEN, () => {}).rotateAutomationSecret("a1").catch((e: unknown) => e);
    expect((err as ApiError).message).toBe("rotate is only for webhook automations");
  });
});

describe("createApi computer backend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs /settings/computer with { backend } and Bearer auth", async () => {
    const fetchMock = vi.fn(async () => respond(200, { key: "computer", value: { backend: "docker" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.putComputerBackend("docker");
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/settings/computer");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ backend: "docker" });
  });
});

describe("createApi apps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /apps and POSTs reload with Bearer auth", async () => {
    const fetchMock = vi.fn(async () => respond(200, { apps: [], appsDir: "/data/apps" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.listApps();
    await api.reloadApps();
    const [listPath, listInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [reloadPath, reloadInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(listPath).toBe("/apps");
    expect(listInit.method).toBe("GET");
    expect((listInit.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(reloadPath).toBe("/apps/reload");
    expect(reloadInit.method).toBe("POST");
    expect((reloadInit.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("POSTs enable with the reviewed hash as the body and encodes the id", async () => {
    const fetchMock = vi.fn(async () => respond(200, { app: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await createApi(TOKEN, () => {}).enableApp("my app/1", "abc123");
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/apps/my%20app%2F1/enable");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ hash: "abc123" });
  });

  it("POSTs disable with no body", async () => {
    const fetchMock = vi.fn(async () => respond(200, { app: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await createApi(TOKEN, () => {}).disableApp("demo");
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/apps/demo/disable");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("maps a 403 for a device to ApiError with the server message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(403, { error: "owner only" })));
    const err = await createApi(TOKEN, () => {}).enableApp("demo", "h").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe("owner only");
  });

  it("maps a 409 for a changed manifest to ApiError with the server message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(409, { error: "manifest changed since review" })));
    const err = await createApi(TOKEN, () => {}).enableApp("demo", "old").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("manifest changed since review");
  });
});

describe("createApi router", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /router with Bearer auth", async () => {
    const fetchMock = vi.fn(async () => respond(200, { strategies: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createApi(TOKEN, () => {}).getRouterStrategies();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/router");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("PUTs the strategy as JSON to the encoded room's router path", async () => {
    const fetchMock = vi.fn(async () => respond(200, { room: { id: "r 1", router: "jev" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await createApi(TOKEN, () => {}).setRoomRouter("r 1", "jev");
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/rooms/r%201/router");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ strategy: "jev" });
    expect(res.room.router).toBe("jev");
  });

  it("maps a 403 for a device to ApiError with the server message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(403, { error: "owner only" })));
    const err = await createApi(TOKEN, () => {}).setRoomRouter("main", "jev").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe("owner only");
  });

  it("maps a 409 for an unavailable strategy to ApiError with the reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(409, { error: "OPENROUTER_API_KEY is not set" })));
    const err = await createApi(TOKEN, () => {}).setRoomRouter("main", "jev").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("OPENROUTER_API_KEY is not set");
  });
});

describe("createApi slack", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /slack with Bearer auth", async () => {
    const fetchMock = vi.fn(async () => respond(200, { enabled: false, inert: "disabled", connected: false, received: 0, sent: 0, dropped: 0, lastError: null, lastEventAt: null }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await createApi(TOKEN, () => {}).getSlackStatus();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/slack");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(res.inert).toBe("disabled");
  });

  it("PUTs the slack setting as JSON to /settings/slack", async () => {
    const fetchMock = vi.fn(async () => respond(200, { key: "slack", value: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const value = { enabled: true, roomId: "main", channelId: "C0123456789", allowedUsers: ["U0123456789"] };
    await createApi(TOKEN, () => {}).putSlack(value);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/settings/slack");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(value);
  });

  it("maps a 403 from a device to ApiError with the server message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(403, { error: "owner only" })));
    const err = await createApi(TOKEN, () => {})
      .putSlack({ enabled: false, roomId: null, channelId: null, allowedUsers: [] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });

  it("maps a 400 validation error to ApiError with the daemon's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(400, { error: "channelId must look like C0123456789" })));
    const err = await createApi(TOKEN, () => {})
      .putSlack({ enabled: true, roomId: "main", channelId: "x", allowedUsers: [] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toBe("channelId must look like C0123456789");
  });
});

describe("createApi transport injection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the injected fetch for every request, including blobs and pairing", async () => {
    const injected = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/computer/screenshot") return new Response("png", { status: 200 });
      return respond(200, { ok: true, url, method: init?.method ?? "GET" });
    });
    const globalFetch = vi.fn(async () => respond(200, {}));
    vi.stubGlobal("fetch", globalFetch);
    const api = createApi(TOKEN, () => {}, injected as unknown as typeof fetch);
    await api.listRooms();
    await api.createRtcInvite();
    await api.computerScreenshot();
    expect(injected).toHaveBeenCalledTimes(3);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("maps the RTC calls to their daemon paths", async () => {
    const fetchMock = vi.fn(async () => respond(200, {}));
    const api = createApi(TOKEN, () => {}, fetchMock as unknown as typeof fetch);
    await api.getRtcStatus();
    await api.createRtcInvite();
    await api.generateRtcTopic();
    await api.putRtc({ enabled: true, server: "https://ntfy.example", topic: "(set)", stun: [] });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([p, i]) => `${i.method} ${p}`)).toEqual([
      "GET /rtc",
      "POST /rtc/invite",
      "POST /rtc/topic",
      "PUT /settings/rtc",
    ]);
    expect(JSON.parse(calls[3]![1].body as string)).toEqual({ enabled: true, server: "https://ntfy.example", topic: "(set)", stun: [] });
  });

  it("sends pairing through an injected fetch without the Bearer header", async () => {
    const injected = vi.fn(async () => respond(200, { deviceId: "d", token: "t" }));
    const globalFetch = vi.fn(async () => respond(200, {}));
    vi.stubGlobal("fetch", globalFetch);
    const { pair } = await import("./api");
    await expect(pair("ABCD-EFGH", "Phone", injected as unknown as typeof fetch)).resolves.toEqual({ deviceId: "d", token: "t" });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe("createApi operations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /backups and /ops and POSTs /backups/run with Bearer auth", async () => {
    const fetchMock = vi.fn(async () => respond(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.getBackups();
    await api.runBackup();
    await api.getOps();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([p, i]) => `${i.method} ${p}`)).toEqual(["GET /backups", "POST /backups/run", "GET /ops"]);
    expect((calls[1]![1].headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("GETs /readiness and POSTs /readiness/apply with Bearer auth", async () => {
    const fetchMock = vi.fn(async () => respond(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi(TOKEN, () => {});
    await api.getReadiness();
    await api.applyReadiness();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([p, i]) => `${i.method} ${p}`)).toEqual(["GET /readiness", "POST /readiness/apply"]);
    expect((calls[1]![1].headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("maps a 403 from readiness apply to ApiError for a device", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(403, { error: "owner only" })));
    const err = await createApi(TOKEN, () => {}).applyReadiness().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });

  it("maps a 500 from a failed backup to ApiError with the daemon's error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(500, { ok: false, error: "disk full" })));
    const err = await createApi(TOKEN, () => {}).runBackup().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe("disk full");
  });
});
