import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "../api";
import { Composer } from "./Composer";

const bots = [
  { id: "boss", name: "Boss", runtime: "api", model: null },
  { id: "coder", name: "Coder", runtime: "acp", model: null, adapter: "claude code" },
];

function type(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value, selectionStart: value.length } });
}

describe("Composer @mention picker", () => {
  it("lists the room's bots when typing @ and filters as you type", () => {
    render(<Composer api={{} as Api} roomId="main" onSend={vi.fn()} bots={bots} />);
    const box = screen.getByRole("combobox");
    type(box, "@");
    expect(screen.getAllByRole("option").length).toBe(3); // boss, coder, everyone
    type(box, "@co");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Coder")]);
  });

  it("inserts the bot id on Enter instead of sending", () => {
    const onSend = vi.fn(async () => {});
    render(<Composer api={{} as Api} roomId="main" onSend={onSend} bots={bots} />);
    const box = screen.getByRole("combobox") as HTMLTextAreaElement;
    type(box, "@co");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("@coder ");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not open inside an email address and closes on Escape", () => {
    render(<Composer api={{} as Api} roomId="main" onSend={vi.fn()} bots={bots} />);
    const box = screen.getByRole("combobox");
    type(box, "mail a@co");
    expect(screen.queryAllByRole("option").length).toBe(0);
    type(box, "@");
    expect(screen.queryAllByRole("option").length).toBe(3);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryAllByRole("option").length).toBe(0);
  });
});
