import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BlenderLogsDialog } from "./BlenderLogsDialog";
import type { BlenderLogEntry, BlenderSession } from "../types";

const closedSession: BlenderSession = {
  instanceId: "session-closed",
  blenderId: "version-42",
  blenderDisplayName: "Blender Experimental",
  blenderVersion: null,
  pid: 4343,
  startedAt: 1,
  projectPath: null,
  isStopping: false,
  isRunning: false,
  closedAt: 2,
  logs: [],
};

const runningSession: BlenderSession = {
  ...closedSession,
  instanceId: "session-running",
  blenderDisplayName: "Blender 4.2.3",
  blenderVersion: "4.2.3",
  projectPath: "D:/Projects/Scene.blend",
  isRunning: true,
  closedAt: null,
};

const logEntry: BlenderLogEntry = {
  id: "log-1",
  instanceId: runningSession.instanceId,
  source: "stdout",
  message: "Startup complete",
  timestamp: 1,
};

describe("BlenderLogsDialog", () => {
  it("renders empty-state copy for closed sessions and closes from the backdrop", () => {
    const onClose = vi.fn();

    render(<BlenderLogsDialog open={true} process={closedSession} logs={[]} onClose={onClose} />);

    expect(screen.getByText("Session Logs")).toBeInTheDocument();
    expect(screen.getByText("Empty session - PID 4343")).toBeInTheDocument();
    expect(screen.getByText("No logs were captured for this session.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks scrolling, closes on escape, and restores the page when dismissed", () => {
    const onClose = vi.fn();
    const { rerender } = render(<BlenderLogsDialog open={true} process={runningSession} logs={[logEntry]} onClose={onClose} />);

    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByText("Live Logs")).toBeInTheDocument();
    expect(screen.getByText("Startup complete")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<BlenderLogsDialog open={false} process={runningSession} logs={[logEntry]} onClose={onClose} />);
    expect(document.body.style.overflow).toBe("");
  });
});
