import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppMenu } from "./AppMenu";

describe("AppMenu", () => {
  it("renders both navigation targets and reports clicks", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<AppMenu activePage="home" onNavigate={onNavigate} />);

    expect(screen.getByRole("button", { name: "Home" })).toHaveClass("page-tab-active");
    fireEvent.click(screen.getByRole("button", { name: "Releases" }));

    rerender(<AppMenu activePage="releases" onNavigate={onNavigate} />);
    expect(screen.getByRole("button", { name: "Releases" })).toHaveClass("page-tab-active");
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, "releases");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "home");
  });
});
