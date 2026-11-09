import { fireEvent, screen } from "@testing-library/react";

/** Opens a Base UI Select trigger the way a pointer does (jsdom has no pointer-capable user-event here). */
export function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.mouseUp(trigger, { button: 0 });
  fireEvent.click(trigger);
}

/** Picks an option of a Base UI SelectField by its trigger (a combobox) and the option's accessible name. */
export async function chooseOption(trigger: HTMLElement, option: string | RegExp) {
  openSelect(trigger);
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerMove(item, { pointerType: "mouse" });
  fireEvent.mouseMove(item);
  fireEvent.pointerDown(item, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(item, { button: 0 });
  fireEvent.pointerUp(item, { button: 0, pointerType: "mouse" });
  fireEvent.mouseUp(item, { button: 0 });
  fireEvent.click(item);
}
