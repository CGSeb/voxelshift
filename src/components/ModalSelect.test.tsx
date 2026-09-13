import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModalSelect } from "./ModalSelect";

const options = [
  { value: "4.3", label: "Blender 4.3" },
  { value: "4.4", label: "Blender 4.4" },
  { value: "4.5", label: "Blender 4.5" },
];

describe("ModalSelect", () => {
  it("navigates with arrows, Home and End without changing the selected value", () => {
    const onChange = vi.fn();
    render(<ModalSelect label="Version" value="4.4" options={options} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Version" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const items = screen.getAllByRole("option");
    expect(items[1]).toHaveFocus();
    for (const [key, index] of [["ArrowDown", 2], ["ArrowDown", 0], ["ArrowUp", 2], ["Home", 0], ["End", 2]] as const) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(items[index]).toHaveFocus();
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(items[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(items[2]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("4.5");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("consumes Escape while open and returns focus without closing its parent", () => {
    const parentKeyDown = vi.fn();
    const onChange = vi.fn();
    render(<div onKeyDown={parentKeyDown}><ModalSelect label="Version" value="4.4" options={options} onChange={onChange} /></div>);
    const trigger = screen.getByRole("button", { name: "Version" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(parentKeyDown).toHaveBeenCalledOnce();
  });

  it("closes when focus leaves the selector, but keeps internal navigation open", () => {
    render(<><ModalSelect label="Version" value="4.4" options={options} onChange={vi.fn()} /><button>Outside</button></>);
    fireEvent.click(screen.getByRole("button", { name: "Version" }));
    act(() => screen.getAllByRole("option")[0].focus());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Outside" }).focus());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not open when disabled and tolerates an empty option list", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ModalSelect label="Version" value="" options={[]} disabled onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Version" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    rerender(<ModalSelect label="Version" value="" options={[]} onChange={onChange} />);
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    fireEvent.keyDown(trigger, { key: "End" });
    expect(screen.getByRole("listbox")).toBeEmptyDOMElement();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
