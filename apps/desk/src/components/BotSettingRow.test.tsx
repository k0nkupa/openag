import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { BookOpen } from "lucide-react";
import { BotSettingRow } from "./BotSettingRow";

it("opens a named right sheet and keeps its draft after closing", async () => {
  render(<BotSettingRow title="Memories" icon={BookOpen}><input aria-label="Draft" defaultValue="Original" /></BotSettingRow>);
  fireEvent.click(screen.getByRole("button", { name: "Memories" }));
  expect((await screen.findByRole("dialog", { name: "Memories" })).getAttribute("data-side")).toBe("right");
  fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(await screen.findByRole("button", { name: "Memories" }));
  expect((await screen.findByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe("Unsaved");
});
