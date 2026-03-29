import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";

describe("AppLayout", () => {
  it("renders the page chrome, metadata, and footer content", () => {
    const onNavigate = vi.fn();

    render(
      <AppLayout
        activePage="home"
        onNavigate={onNavigate}
        eyebrow="Workspace"
        title="Voxel Shift"
        description="A launcher for Blender"
        footer={<div>Footer content</div>}
      >
        <div>Main content</div>
      </AppLayout>,
    );

    expect(screen.getByText("Voxel Shift")).toBeInTheDocument();
    expect(screen.getByText("A launcher for Blender")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Main content")).toBeInTheDocument();
    expect(screen.getByText("Footer content")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    expect(onNavigate).toHaveBeenCalledWith("planner");
  });

  it("omits optional metadata blocks when they are not provided", () => {
    render(
      <AppLayout activePage="releases" onNavigate={vi.fn()} eyebrow="" title="" description="">
        <div>Body only</div>
      </AppLayout>,
    );

    expect(screen.getByText("Body only")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Footer content")).not.toBeInTheDocument();
  });
});
