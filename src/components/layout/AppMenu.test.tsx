import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppMenu } from "./AppMenu";

describe("AppMenu", () => {
  it("renders all navigation targets in order and reports clicks", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<AppMenu activePage="home" onNavigate={onNavigate} />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Home", "Releases", "Planner"]);
    expect(screen.getByRole("button", { name: "Home" })).toHaveClass("page-tab-active");
    fireEvent.click(screen.getByRole("button", { name: "Releases" }));

    rerender(<AppMenu activePage="planner" onNavigate={onNavigate} />);
    expect(screen.getByRole("button", { name: "Planner" })).toHaveClass("page-tab-active");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, "releases");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "planner");
    expect(onNavigate).toHaveBeenNthCalledWith(3, "home");
  });
});
