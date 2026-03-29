import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePlannerRunPayload } from "../lib/api";
import { PlannerPage } from "./PlannerPage";
import type { BlenderVersion, PlannerRunSummary } from "../types";

const primaryVersion: BlenderVersion = {
  id: "version-43",
  displayName: "Blender 4.3.0",
  version: "4.3.0",
  executablePath: "D:\\Tools\\Blender 4.3\\blender.exe",
  installDir: "D:\\VoxelShift\\stable\\Blender 4.3.0",
  source: "manual",
  available: true,
  isDefault: true,
  lastLaunchedAt: null,
};

const secondaryVersion: BlenderVersion = {
  id: "version-42",
  displayName: "Blender 4.2.0",
  version: "4.2.0",
  executablePath: "D:\\Tools\\Blender 4.2\\blender.exe",
  installDir: "D:\\VoxelShift\\stable\\Blender 4.2.0",
  source: "manual",
  available: true,
  isDefault: false,
  lastLaunchedAt: null,
};

const pendingRun: PlannerRunSummary = {
  id: "planner-pending",
  blendFilePath: "D:\\Projects\\pending-scene.blend",
  startFrame: 1,
  endFrame: 120,
  startAt: 1_775_688_000,
  createdAt: 1_775_684_400,
  startedAt: null,
  completedAt: null,
  status: "pending",
  blenderTarget: {
    source: "library",
    versionId: primaryVersion.id,
    displayName: primaryVersion.displayName,
    executablePath: primaryVersion.executablePath,
  },
  currentFrame: null,
  renderedFrameCount: 0,
  averageRenderTimeSeconds: null,
  estimatedRemainingSeconds: null,
  pid: null,
  lastErrorMessage: null,
  exitCode: null,
};

const runningRun: PlannerRunSummary = {
  ...pendingRun,
  id: "planner-running",
  blendFilePath: "D:\\Projects\\running-scene.blend",
  status: "running",
  currentFrame: null,
  pid: 4242,
};

const failedRun: PlannerRunSummary = {
  ...pendingRun,
  id: "planner-failed",
  blendFilePath: "D:\\Projects\\failed-scene.blend",
  status: "failed",
  lastErrorMessage: null,
};

const completedRun: PlannerRunSummary = {
  ...pendingRun,
  id: "planner-completed",
  blendFilePath: "D:\\Projects\\completed-scene.blend",
  status: "completed",
  currentFrame: 120,
  renderedFrameCount: 120,
  averageRenderTimeSeconds: 3,
  estimatedRemainingSeconds: null,
  completedAt: pendingRun.startAt + 360,
};

function createDefaultProps() {
  return {
    blenderVersions: [primaryVersion, secondaryVersion],
    plannerRuns: [] as PlannerRunSummary[],
    errorMessage: null,
    submitErrorMessage: null,
    noticeMessage: null,
    isLoading: false,
    isCreating: false,
    onCreateRun: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    onUpdateRun: vi.fn<(runId: string, payload: CreatePlannerRunPayload) => Promise<boolean>>().mockResolvedValue(true),
    onBrowseBlendFile: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    onBrowseCustomBlender: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    onBrowseOutputFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    onOpenLogs: vi.fn<(run: PlannerRunSummary) => void>(),
    onDeleteRun: vi.fn<(run: PlannerRunSummary) => void>(),
  };
}

function formatDayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

describe("PlannerPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    document.body.style.overflow = "";
  });

  it("shows error, loading, and empty planner states", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PlannerPage {...props} errorMessage="Planner service offline" />);

    expect(screen.getByText("Could not load planner runs")).toBeInTheDocument();
    expect(screen.getByText("Planner service offline")).toBeInTheDocument();

    rerender(<PlannerPage {...props} errorMessage={null} isLoading={true} />);
    expect(screen.getByText("Loading planner runs")).toBeInTheDocument();

    rerender(<PlannerPage {...props} errorMessage={null} isLoading={false} />);
    expect(screen.getByText("No renders scheduled yet")).toBeInTheDocument();
  });

  it("validates inputs, lets users configure custom Blender runs, and closes after a successful save", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-03-29T10:00:00").getTime());

    const props = createDefaultProps();
    props.onCreateRun.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    props.onBrowseCustomBlender.mockResolvedValue("D:\\Tools\\Custom Blender\\blender.exe");
    props.onBrowseOutputFolder.mockResolvedValue("D:\\Renders\\Shot_020");

    render(<PlannerPage {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    const modal = await screen.findByRole("dialog", { name: "Schedule a background animation render" });
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(within(modal).getByRole("button", { name: "Installed Blender" }));

    const libraryOptions = await within(modal).findAllByRole("option");
    expect(libraryOptions.map((option) => option.textContent?.trim())).toEqual(["Blender 4.2.0", "Blender 4.3.0"]);
    fireEvent.click(within(modal).getByRole("option", { name: "Blender 4.2.0" }));

    fireEvent.click(within(modal).getByRole("button", { name: "Choose start time" }));
    const startTimePicker = await screen.findByRole("dialog", { name: "Start time picker" });

    fireEvent.click(within(startTimePicker).getByRole("button", { name: "Show next month" }));
    fireEvent.click(within(startTimePicker).getByRole("button", { name: formatDayLabel(new Date(2026, 3, 15)) }));
    fireEvent.change(within(startTimePicker).getByLabelText("Hour"), { target: { value: "24" } });
    fireEvent.change(within(startTimePicker).getByLabelText("Minute"), { target: { value: "99" } });
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Start time picker" })).not.toBeInTheDocument();
    });

    fireEvent.click(within(modal).getByRole("tab", { name: "Custom build" }));
    fireEvent.click(within(modal).getByRole("button", { name: "Browse custom Blender executable" }));

    await waitFor(() => {
      expect(props.onBrowseCustomBlender).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(within(modal).getByLabelText("Blend file"), { target: { value: "D:\\Projects\\shot-020.blend" } });
    fireEvent.click(within(modal).getByLabelText("Override output folder"));
    fireEvent.click(within(modal).getByRole("button", { name: "Schedule render" }));

    expect(await screen.findByText("Please choose an output folder.")).toBeInTheDocument();
    expect(props.onCreateRun).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole("button", { name: "Browse output folder" }));
    await waitFor(() => {
      expect(props.onBrowseOutputFolder).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByText("Please choose an output folder.")).not.toBeInTheDocument();
    });

    fireEvent.click(within(modal).getByRole("button", { name: "Schedule render" }));

    await waitFor(() => {
      expect(props.onCreateRun).toHaveBeenNthCalledWith(1, {
        blendFilePath: "D:\\Projects\\shot-020.blend",
        startFrame: 1,
        endFrame: 250,
        startAt: Math.floor(new Date("2026-04-15T23:59").getTime() / 1000),
        outputFolderPath: "D:\\Renders\\Shot_020",
        blender: {
          source: "custom",
          versionId: null,
          executablePath: "D:\\Tools\\Custom Blender\\blender.exe",
        },
      });
    });
    expect(screen.getByRole("dialog", { name: "Schedule a background animation render" })).toBeInTheDocument();

    fireEvent.click(within(modal).getByRole("button", { name: "Schedule render" }));

    await waitFor(() => {
      expect(props.onCreateRun).toHaveBeenNthCalledWith(2, {
        blendFilePath: "D:\\Projects\\shot-020.blend",
        startFrame: 1,
        endFrame: 250,
        startAt: Math.floor(new Date("2026-04-15T23:59").getTime() / 1000),
        outputFolderPath: "D:\\Renders\\Shot_020",
        blender: {
          source: "custom",
          versionId: null,
          executablePath: "D:\\Tools\\Custom Blender\\blender.exe",
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Schedule a background animation render" })).not.toBeInTheDocument();
    });
    expect(document.body.style.overflow).toBe("");
  });

  it("handles picker escape shortcuts and respects the isCreating guard", async () => {
    const props = createDefaultProps();
    const { rerender } = render(<PlannerPage {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    const modal = await screen.findByRole("dialog", { name: "Schedule a background animation render" });
    fireEvent.click(within(modal).getByRole("button", { name: "Choose start time" }));
    expect(await screen.findByRole("dialog", { name: "Start time picker" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Start time picker" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Schedule a background animation render" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Installed Blender" }));
    expect(await screen.findByRole("listbox", { name: "Installed Blender versions" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: "Installed Blender versions" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Schedule a background animation render" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Schedule a background animation render" })).not.toBeInTheDocument();
    });

    rerender(<PlannerPage {...props} isCreating={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    const savingModal = await screen.findByRole("dialog", { name: "Schedule a background animation render" });
    fireEvent.click(screen.getByRole("presentation"));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(savingModal).toBeInTheDocument();
    expect(within(savingModal).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(savingModal).getByRole("button", { name: "Scheduling..." })).toBeDisabled();
  });

  it("renders planner run states and wires row actions", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-04-01T12:00:00").getTime());

    const props = createDefaultProps();
    render(<PlannerPage {...props} plannerRuns={[pendingRun, runningRun, failedRun, completedRun]} />);

    expect(screen.getByText("pending-scene.blend")).toBeInTheDocument();
    expect(screen.getByText("Waiting for frame output")).toBeInTheDocument();
    expect(screen.getByText("Render failed")).toBeInTheDocument();
    expect(screen.getByText(/6m 0s/)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Edit pending-scene.blend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open logs for failed-scene.blend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open logs for completed-scene.blend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete running-scene.blend" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Open logs for completed-scene.blend" }));
    expect(props.onOpenLogs).toHaveBeenCalledWith(completedRun);

    fireEvent.click(screen.getByRole("button", { name: "Delete completed-scene.blend" }));
    expect(props.onDeleteRun).toHaveBeenCalledWith(completedRun);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate failed-scene.blend" }));
    const duplicateModal = await screen.findByRole("dialog", { name: "Schedule a background animation render" });
    expect(within(duplicateModal).getByDisplayValue(failedRun.blendFilePath)).toBeInTheDocument();
    expect(within(duplicateModal).getByDisplayValue(String(failedRun.endFrame))).toBeInTheDocument();

    fireEvent.click(within(duplicateModal).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit pending-scene.blend" }));
    const editModal = await screen.findByRole("dialog", { name: "Edit a planned background animation render" });
    expect(within(editModal).getByDisplayValue(pendingRun.blendFilePath)).toBeInTheDocument();
    expect(within(editModal).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("disables library submission when no installed Blender versions are available", async () => {
    const props = createDefaultProps();

    render(<PlannerPage {...props} blenderVersions={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    const modal = await screen.findByRole("dialog", { name: "Schedule a background animation render" });
    expect(within(modal).getByRole("button", { name: "Installed Blender" })).toBeDisabled();
    expect(within(modal).getByText("No installed Blender versions found")).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "Schedule render" })).toBeDisabled();
  });
});
