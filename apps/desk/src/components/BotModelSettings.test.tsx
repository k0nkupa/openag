import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BotModelSettings } from "./BotModelSettings";
import { chooseOption } from "../test/select";
import type { Api } from "../api";
import type { BotModelState, ModelChoices } from "../types";

vi.mock("../stream", () => { const subscribe = () => () => {}; return { useStream: () => ({ subscribe }) }; });
const bot = { id: "boss", name: "Boss", runtime: "api", model: "openai/a" };
const initial: BotModelState = { revision: "one", runtime: "api", target: "openai", model: "openai/a", reasoning: {}, override: null, effectiveModel: "openai/a", reports: [] };
const choices: ModelChoices = { target: "openai", revision: "one", snapshotId: "snapshot", model: "openai/a", models: [{ id: "openai/a", name: "Fixture A" }, { id: "openai/b", name: "Fixture B" }], controls: [{ id: "effort", name: "Effort", values: [{ value: "high", name: "High" }] }], reason: null, source: "Controlled choices" };
const targets = async () => ({ targets: [{ id: "openai", name: "OpenAI", configured: true }] });
const discover = async (_: string, input: { model?: string }) => ({ ...choices, model: input.model ?? choices.model });
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Model and reasoning" }));
  await screen.findByRole("button", { name: "Model: Fixture A" });
  await screen.findByLabelText("Effort");
}
async function chooseB() {
  fireEvent.click(screen.getByRole("button", { name: "Model: Fixture A" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Fixture B" }));
  await screen.findByRole("button", { name: "Model: Fixture B" });
}

it("preloads on opening and reconciles an unconfirmed save without resubmitting", async () => {
  let current = initial;
  const readChoices = vi.fn(discover);
  const save = vi.fn(async () => { current = { ...initial, revision: "two", model: "openai/b", effectiveModel: "openai/b", reasoning: { effort: "high" } }; throw Error("Lost response"); });
  const api = { botCreationTargets: targets, getBotModel: async () => current, discoverBotModel: readChoices, putBotModel: save } as unknown as Api;
  render(<BotModelSettings api={api} bot={bot} onSaved={() => {}} />);
  expect(readChoices).not.toHaveBeenCalled();
  await open();
  expect(screen.queryByRole("button", { name: "Refresh choices" })).toBeNull();
  await chooseB();
  await chooseOption(screen.getByRole("combobox", { name: "Effort" }), "High");
  fireEvent.click(screen.getByRole("button", { name: "Save model configuration" }));
  await screen.findByText("Save confirmed by readback. No retry was sent.");
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("boss", { revision: "one", snapshotId: "snapshot", model: "openai/b", reasoning: { effort: "high" } });
  // The requested model lives in the diagnostics disclosure; routine UI carries no requested-versus-returned disclaimer.
  expect(screen.getByText("Requested model").nextElementSibling?.textContent).toBe("openai/b");
  expect(screen.queryByText(/runtime confirmation/)).toBeNull();
});

it("shows an administrator override without discovering choices", async () => {
  const readChoices = vi.fn();
  const api = { botCreationTargets: targets, getBotModel: async () => ({ ...initial, override: "openai/admin" }), discoverBotModel: readChoices } as unknown as Api;
  render(<BotModelSettings api={api} bot={bot} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model and reasoning" }));
  await screen.findByText(/An administrator controls this model/);
  expect((screen.getByRole("button", { name: "Save model configuration" }) as HTMLButtonElement).disabled).toBe(true);
  expect(readChoices).not.toHaveBeenCalled();
});

it("retains compatible effort when the model changes", async () => {
  const current = { ...initial, reasoning: { effort: "high" } };
  const api = { botCreationTargets: targets, getBotModel: async () => current, discoverBotModel: discover } as unknown as Api;
  render(<BotModelSettings api={api} bot={bot} onSaved={() => {}} />);
  await open(); await chooseB();
  expect(screen.getByRole("combobox", { name: "Effort" }).textContent).toContain("High");
});

it("keeps failed save drafts and prevents concurrent submissions", async () => {
  let rejectSave!: (reason: Error) => void;
  const save = vi.fn(() => new Promise((_, reject) => { rejectSave = reject; }));
  const api = { botCreationTargets: targets, getBotModel: async () => initial, discoverBotModel: discover, putBotModel: save } as unknown as Api;
  render(<BotModelSettings api={api} bot={bot} onSaved={() => {}} />);
  await open(); await chooseB();
  await chooseOption(screen.getByRole("combobox", { name: "Effort" }), "High");
  const button = screen.getByRole("button", { name: "Save model configuration" });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  rejectSave(Error("Controlled validation refusal"));
  await screen.findByText(/Save was not confirmed. Your draft is kept/);
  expect(screen.getByRole("combobox", { name: "Effort" }).textContent).toContain("High");
});

it("selects another source directly from grouped models and saves its supported budget", async () => {
  let current = initial;
  const google = { ...choices, target: "google", model: "google/gemini", models: [{ id: "google/gemini", name: "Gemini" }], controls: [{ id: "budget_tokens", name: "Thinking token budget", min: 128, max: 32768 }] };
  const readChoices = vi.fn(async (id: string, input: { target: string; model?: string }) => input.target === "google" ? google : discover(id, input));
  const save = vi.fn(async () => { current = { ...current, revision: "two", target: "google", model: "google/gemini", reasoning: { budget_tokens: 2048 } }; return current; });
  const api = { botCreationTargets: async () => ({ targets: [{ id: "openai", name: "OpenAI", configured: true }, { id: "google", name: "Google", configured: true }] }), getBotModel: async () => current, discoverBotModel: readChoices, putBotModel: save } as unknown as Api;
  render(<BotModelSettings api={api} bot={bot} onSaved={() => {}} />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Model: Fixture A" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Gemini" }));
  fireEvent.change(await screen.findByLabelText("Thinking token budget"), { target: { value: "2048" } });
  fireEvent.click(screen.getByRole("button", { name: "Save model configuration" }));
  await screen.findByText("Saved.");
  expect(save).toHaveBeenCalledWith("boss", { revision: "one", snapshotId: "snapshot", model: "google/gemini", reasoning: { budget_tokens: 2048 } });
});
