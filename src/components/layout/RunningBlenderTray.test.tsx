import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunningBlenderTray } from "./RunningBlenderTray";
import type { BlenderSession } from "../../types";

const runningSession: BlenderSession = {
  instanceId: "session-running",
  blenderId: "version-42",
  blenderDisplayName: "Blender 4.2.3",
  blenderVersion: "4.2.3",
  pid: 4242,
  startedAt: 1,
  projectPath: "D:/Projects/Scene.blend",
  isStopping: false,
  isRunning: true,
  closedAt: null,
  logs: [],
};

const closedSession: BlenderSession = {
  ...runningSession,
  instanceId: "session-closed",
  pid: 4343,
  projectPath: null,
  isRunning: false,
  closedAt: 2,
};

describe("RunningBlenderTray", () => {
  it("renders running and recent sessions with the expected actions", () => {
    const onToggle = vi.fn();
    const onOpenLogs = vi.fn();
    const onStop = vi.fn();

    render(
      <RunningBlenderTray
        processes={[runningSession, closedSession]}
        isOpen={true}
        onToggle={onToggle}
        onOpenLogs={onOpenLogs}
        onStop={onStop}
      />,
    );

    expect(screen.getByText("1 running, 1 recent")).toBeInTheDocument();
    expect(screen.getByText("Scene.blend")).toBeInTheDocument();
    expect(screen.getByText("Empty session")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Blender tray" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "View live logs" }));
    expect(onOpenLogs).toHaveBeenCalledWith(runningSession);

    fireEvent.click(screen.getByRole("button", { name: "View logs" }));
    expect(onOpenLogs).toHaveBeenCalledWith(closedSession);

    fireEvent.click(screen.getByRole("button", { name: "Stop Blender" }));
    expect(onStop).toHaveBeenCalledWith(runningSession);
  });

  it("shows the recent-session summary when all sessions are closed", () => {
    render(
      <RunningBlenderTray
        processes={[closedSession]}
        isOpen={false}
        onToggle={vi.fn()}
        onOpenLogs={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText("1 recent session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Blender tray" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop Blender" })).not.toBeInTheDocument();
  });
});
