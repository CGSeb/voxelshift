import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlannerLogsDialog } from "./PlannerLogsDialog";
import type { PlannerLogEntry, PlannerRunSummary } from "../types";

const runningRun: PlannerRunSummary = {
  id: "planner-running",
  blendFilePath: "D:\\Projects\\running-scene.blend",
  startFrame: 1,
  endFrame: 120,
  startAt: 1_775_688_000,
  shutdownWhenDone: false,
  createdAt: 1_775_684_400,
  startedAt: 1_775_688_000,
  completedAt: null,
  status: "running",
  blenderTarget: {
    source: "library",
    versionId: "version-42",
    displayName: "Blender 4.2.0",
    executablePath: "D:\\Tools\\Blender 4.2\\blender.exe",
  },
  currentFrame: 12,
  renderedFrameCount: 12,
  averageRenderTimeSeconds: 3,
  estimatedRemainingSeconds: 324,
  pid: 4242,
  lastErrorMessage: null,
  exitCode: null,
};

const completedRun: PlannerRunSummary = {
  ...runningRun,
  id: "planner-completed",
  blendFilePath: "D:\\Projects\\completed-scene.blend",
  status: "completed",
  pid: null,
  completedAt: runningRun.startAt + 360,
};

const logEntry: PlannerLogEntry = {
  id: "planner-running-0",
  runId: runningRun.id,
  source: "stdout",
  message: "Fra:12 Mem:42.00M",
  timestamp: 1_775_688_012,
};

describe("PlannerLogsDialog", () => {
  it("returns nothing when closed or when no run is selected", () => {
    const { rerender } = render(<PlannerLogsDialog open={false} run={runningRun} logs={[logEntry]} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<PlannerLogsDialog open={true} run={null} logs={[logEntry]} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows live logs, ignores clicks inside the dialog, and closes from escape or the backdrop", () => {
    const onClose = vi.fn();

    render(<PlannerLogsDialog open={true} run={runningRun} logs={[logEntry]} onClose={onClose} />);

    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByText("Live Planner Logs")).toBeInTheDocument();
    expect(screen.getByText("running-scene.blend")).toBeInTheDocument();
    expect(screen.getByText("Blender 4.2.0 - PID 4242")).toBeInTheDocument();
    expect(screen.getByText("Fra:12 Mem:42.00M")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders the completed-run empty state and restores body scrolling when dismissed", () => {
    const onClose = vi.fn();
    const { rerender } = render(<PlannerLogsDialog open={true} run={completedRun} logs={[]} onClose={onClose} />);

    expect(screen.getByText("Planner Run Logs")).toBeInTheDocument();
    expect(screen.getByText("No logs were captured for this planner run.")).toBeInTheDocument();

    rerender(<PlannerLogsDialog open={false} run={completedRun} logs={[]} onClose={onClose} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("renders the running empty state when Blender has not produced logs yet", () => {
    render(<PlannerLogsDialog open={true} run={runningRun} logs={[]} onClose={vi.fn()} />);
    expect(screen.getByText("Waiting for Blender to write render logs.")).toBeInTheDocument();
  });
});
