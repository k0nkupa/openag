import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModelsPage } from "./ModelsPage";
import type { Api } from "../api";

describe("ModelsPage", () => {
  it("shows CLI, provider and Ollama status without any key value", async () => {
    const api = {
      getModelsStatus: async () => ({
        clis: [{ id: "codex", name: "Codex", adapterPackage: "@agentclientprotocol/codex-acp", adapterInstalled: false, usedBy: ["coder"] }, { id: "claude-code", name: "Claude Code", adapterPackage: "@agentclientprotocol/claude-agent-acp", adapterInstalled: true, usedBy: [] }],
        providers: [{ id: "anthropic", name: "Anthropic", envVar: "ANTHROPIC_API_KEY", set: true, last4: "1234", usedFor: "API bots" }, { id: "openai", name: "OpenAI", envVar: "OPENAI_API_KEY", set: false, last4: null, usedFor: "API bots" }],
        ollama: { url: "http://127.0.0.1:11434", reachable: true, models: ["llama3"], embedModel: "nomic-embed-text", embedEnabled: true },
      }),
      getModelCatalogue: async () => ({ sources: [] }),
      refreshModelCatalogue: async () => ({ sources: [] }),
      getDictation: async () => ({ enabled: false, provider: "openai", model: "", reason: "", target: "", configured: false, available: false, maxBytes: 0, maxSeconds: 0, choices: [] }),
      whoami: async () => ({ kind: "owner" }),
      listRooms: async () => ({ rooms: [] }),
      getRouterStrategies: async () => ({ strategies: [] }),
    } as unknown as Api;
    render(<ModelsPage api={api} />);
    await screen.findByText("Adapter missing");
    const configured = screen.getByRole("region", { name: "Configured API providers" });
    expect(within(configured).getByText("Key present · ••••1234")).toBeTruthy();
    expect(within(configured).getByText("Present").getAttribute("data-variant")).toBe("success");
    expect(screen.getByText("Installed").getAttribute("data-variant")).toBe("success");
    expect(screen.queryByText(/service not checked/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Browse all supported providers" }));
    const search = screen.getByRole("textbox", { name: "Search API providers" });
    expect(configured.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(search, { target: { value: "openai" } });
    expect(within(configured).getByText("Anthropic")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "All API providers" })).queryByText("Anthropic")).toBeNull();
    expect(screen.getByText("Not configured").getAttribute("data-variant")).toBe("attention");
    expect(screen.getByText("Responding")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy install command" })).toBeTruthy();
    expect(screen.queryByText(/Decisions API via OpenRouter/)).toBeNull();
  });
});
