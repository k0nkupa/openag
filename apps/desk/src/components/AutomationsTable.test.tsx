import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AutomationsTable } from "./AutomationsTable";
import type { Api } from "../api";
import type { Automation } from "../types";

const row = (o: Partial<Automation>): Automation =>
  ({ id: "a1", name: "Morning brief", scheduleCron: "30 7 * * 1-5", tz: null, botId: "boss", roomId: "main", prompt: "p", enabled: true, allowApprovals: false, createdAt: 0, updatedAt: 0, lastRunAt: null, lastStatus: null, lastTurnId: null, triggerKind: "cron", hookSlug: null, hookPath: null, hookEvents:[],outputMode:"room",allowTools:false,lastVerdict:null,hasSecret:false,pollRepo:null,pollEveryMinutes:null,lastPolledAt:null,lastPollNew:null, ...o }) as Automation;

describe("AutomationsTable", () => {
  it("lists automations with trigger, bot · room and state", async () => {
    const api = { listAutomations: async () => ({ automations: [row({}), row({ id: "a2", name: "Weekly note", enabled: false })] }) } as unknown as Api;
    render(<AutomationsTable rows={(await api.listAutomations()).automations} actions={()=>null} />);
    await screen.findByText("Morning brief");
    expect(screen.getAllByText("30 7 * * 1-5").length).toBe(2);
    expect(screen.getAllByText("boss · #main").length).toBe(2);
    expect(screen.getByText("Paused")).toBeTruthy();
  });
});
