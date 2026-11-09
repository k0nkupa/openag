import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "../api";
import { SkillsPanel } from "./SkillsPanel";
import { chooseOption } from "../test/select";

const bots = [
  { id: "boss", name: "Boss", runtime: "api", model: null },
  { id: "coder", name: "Coder", runtime: "acp", model: null },
];

const bossSkills = [{ slug: "weekly-report", name: "Weekly report", description: "Summarise the week", version: 3 }];

const bossSkill = {
  slug: "weekly-report",
  name: "Weekly report",
  description: "Summarise the week",
  version: 3,
  triggers: ["weekly", "report"],
  body: "<script>alert(1)</script>\nStep one",
};

function makeApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    whoami: vi.fn(async () => ({ kind: "device", access: "limited" })),
    getSkillLibrary: vi.fn(async () => ({ enabled: false })),
    listBots: vi.fn(async () => ({ bots })),
    listSkills: vi.fn(async (id: string) => ({ skills: id === "boss" ? bossSkills : [] })),
    getSkill: vi.fn(async () => ({ skill: bossSkill })),
    ...overrides,
  } as unknown as Api & {
    listBots: ReturnType<typeof vi.fn>;
    listSkills: ReturnType<typeof vi.fn>;
    getSkill: ReturnType<typeof vi.fn>;
  };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe("SkillsPanel", () => {
  it("lists the first bot's skills with name, slug, description and version", async () => {
    const api = makeApi();
    render(<SkillsPanel api={api} />);
    await flush();
    expect(api.listSkills).toHaveBeenCalledWith("boss");
    expect(screen.getByText("Weekly report")).toBeTruthy();
    expect(screen.getByText(/weekly-report.*v3/)).toBeTruthy();
    expect(screen.getByText("Summarise the week")).toBeTruthy();
    expect(screen.getByText(/Choose the workflows this agent can use/)).toBeTruthy();
  });

  it("switching bot reloads that bot's skills", async () => {
    const api = makeApi();
    render(<SkillsPanel api={api} />);
    await flush();
    await chooseOption(screen.getByRole("combobox"), /Coder/);
    await flush();
    expect(api.listSkills).toHaveBeenLastCalledWith("coder");
    expect(screen.getByText("No skills yet")).toBeTruthy();
    expect(screen.queryByText("Weekly report")).toBeNull();
  });

  it("selecting a skill shows its body and triggers as inert text", async () => {
    const api = makeApi();
    const { container } = render(<SkillsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Weekly report/ }));
    await flush();
    expect(api.getSkill).toHaveBeenCalledWith("boss", "weekly-report");
    const pre = screen.getByTestId("skill-body");
    expect(pre?.textContent).toBe("<script>alert(1)</script>\nStep one");
    expect(container.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Package details/ }));
    await flush();
    expect(screen.getByText("Triggers: weekly, report")).toBeTruthy();
  });

  it("shows an inline error when getSkill returns 404", async () => {
    const api = makeApi({
      getSkill: vi.fn(async () => Promise.reject(Object.assign(new Error("skill not found"), { status: 404 }))),
    });
    render(<SkillsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Weekly report/ }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("skill not found");
  });

  it("shows the empty state when the bot has no skills", async () => {
    const api = makeApi({ listSkills: vi.fn(async () => ({ skills: [] })) });
    render(<SkillsPanel api={api} />);
    await flush();
    expect(screen.getByText("No skills yet")).toBeTruthy();
  });

  it("shows a load error without crashing", async () => {
    const api = makeApi({ listSkills: vi.fn(async () => Promise.reject(new Error("Cannot reach the daemon"))) });
    render(<SkillsPanel api={api} />);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Cannot reach the daemon");
  });
});

it("loads only the scoped bot's skills without a bot selector", async () => {
  const api = makeApi();
  render(<SkillsPanel api={api} botId="boss" />);
  await screen.findByText("Weekly report");
  expect(api.listSkills).toHaveBeenCalledWith("boss");
  expect(api.listBots).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox", { name: "Bot" })).toBeNull();
});
