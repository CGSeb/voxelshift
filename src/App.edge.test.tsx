import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  BlenderLogEntry,
  BlenderReleaseDownload,
  BlenderReleaseListing,
  BlenderVersion,
  LauncherState,
  PlannerLogEntry,
  PlannerRunSummary,
  RecentProject,
  RunningBlenderProcess,
} from "./types";

const tauriMocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  listen: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  applyBlenderConfig: vi.fn(),
  cancelBlenderReleaseInstall: vi.fn(),
  createPlannerRun: vi.fn(),
  deletePlannerRun: vi.fn(),
  updatePlannerRun: vi.fn(),
  getBlenderConfigs: vi.fn(),
  getBlenderReleaseDownloads: vi.fn(),
  getLauncherState: vi.fn(),
  getPlannerLogs: vi.fn(),
  getPlannerRuns: vi.fn(),
  getRecentProjects: vi.fn(),
  refreshManagedBlenderExtensions: vi.fn(),
  getRunningBlenderLogs: vi.fn(),
  getRunningBlenders: vi.fn(),
  installBlenderRelease: vi.fn(),
  launchBlender: vi.fn(),
  launchBlenderProject: vi.fn(),
  pickPlannerBlendFile: vi.fn(),
  pickPlannerBlenderExecutable: vi.fn(),
  pickPlannerOutputFolder: vi.fn(),
  removeBlenderConfig: vi.fn(),
  removeRecentProject: vi.fn(),
  removeBlenderVersion: vi.fn(),
  saveBlenderConfig: vi.fn(),
  stopRunningBlender: vi.fn(),
}));

const updaterMocks = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: tauriMocks.getVersion,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen,
}));

vi.mock("./lib/api", () => apiMocks);
vi.mock("./lib/updater", () => ({
  checkForAppUpdate: updaterMocks.checkForAppUpdate,
}));

const favoriteReleaseStorageKey = "voxelshift.favorite-release-downloads";

const installedVersion: BlenderVersion = {
  id: "version-42",
  displayName: "Blender 4.2.3",
  version: "4.2.3",
  executablePath: "D:\\Blender\\blender.exe",
  installDir: "D:\\Users\\Sebastien\\Documents\\VoxelShift\\stable\\Blender 4.2.3",
  source: "manual",
  available: true,
  isDefault: true,
  lastLaunchedAt: null,
};

const launcherState: LauncherState = {
  versions: [installedVersion],
  scanRoots: [],
  detectedAt: 1,
};

const stableDownload: BlenderReleaseDownload = {
  id: "release-legacy",
  channel: "Blender4.2",
  version: "4.2.3",
  fileName: "blender-4.2.3-windows-x64.zip",
  releaseDate: "2026-03-20",
  url: "https://download.blender.org/release/Blender4.2/blender-4.2.3-windows-x64.zip",
};

const releaseListing: BlenderReleaseListing = {
  platformLabel: "Windows x64",
  stableDownloads: [stableDownload],
  experimentalGroups: [],
  experimentalError: null,
};

const recentProject: RecentProject = {
  id: "project-1",
  name: "Test Scene",
  filePath: "D:\\Projects\\test-scene.blend",
  thumbnailPath: null,
  blenderId: installedVersion.id,
  blenderDisplayName: installedVersion.displayName,
  blenderVersion: installedVersion.version,
  savedAt: "not-a-date",
  exists: true,
};

const runningBlender: RunningBlenderProcess = {
  instanceId: "session-1",
  blenderId: installedVersion.id,
  blenderDisplayName: installedVersion.displayName,
  blenderVersion: installedVersion.version,
  pid: 4242,
  startedAt: 1,
  projectPath: recentProject.filePath,
  isStopping: false,
};

const runningBlenderLog: BlenderLogEntry = {
  id: "session-1-0",
  instanceId: runningBlender.instanceId,
  source: "stdout",
  message: "Loading startup file",
  timestamp: 1,
};

const plannerRun: PlannerRunSummary = {
  id: "planner-1",
  blendFilePath: "D:\\Projects\\render-scene.blend",
  startFrame: 1,
  endFrame: 120,
  startAt: 1_700_000_000,
  outputFolderPath: "D:\\Renders\\Shot_010",
  shutdownWhenDone: false,
  createdAt: 1_700_000_000,
  startedAt: null,
  completedAt: null,
  status: "pending",
  blenderTarget: {
    source: "library",
    versionId: installedVersion.id,
    displayName: installedVersion.displayName,
    executablePath: installedVersion.executablePath,
  },
  currentFrame: null,
  renderedFrameCount: 0,
  averageRenderTimeSeconds: null,
  estimatedRemainingSeconds: null,
  pid: null,
  lastErrorMessage: null,
  exitCode: null,
};

const plannerLog: PlannerLogEntry = {
  id: "planner-1-0",
  runId: plannerRun.id,
  source: "stdout",
  message: "Fra:1 Mem:30.00M",
  timestamp: 2,
};

const runningBlendersEvent = "running-blenders-updated";
const runningBlenderLogEvent = "running-blender-log";
const plannerRunsEvent = "planner-runs-updated";
const plannerLogEvent = "planner-log";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function emitTauriEvent<TPayload>(eventName: string, payload: TPayload) {
  const listener = tauriMocks.listen.mock.calls.find((call) => call[0] === eventName)?.[1] as
    | ((event: { payload: TPayload }) => void)
    | undefined;
  listener?.({ payload });
}

function emitRunningBlenders(processes: RunningBlenderProcess[]) {
  emitTauriEvent(runningBlendersEvent, processes);
}

function emitRunningBlenderLog(entry: BlenderLogEntry) {
  emitTauriEvent(runningBlenderLogEvent, { instanceId: entry.instanceId, entry });
}

function emitPlannerRuns(runs: PlannerRunSummary[]) {
  emitTauriEvent(plannerRunsEvent, runs);
}

function emitPlannerLog(entry: PlannerLogEntry) {
  emitTauriEvent(plannerLogEvent, { runId: entry.runId, entry });
}

describe("App edge coverage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    localStorage.clear();
    tauriMocks.getVersion.mockReset();
    tauriMocks.listen.mockReset();
    updaterMocks.checkForAppUpdate.mockReset();

    for (const mock of Object.values(apiMocks)) {
      mock.mockReset();
    }

    tauriMocks.getVersion.mockResolvedValue("1.0.0");
    tauriMocks.listen.mockResolvedValue(vi.fn());
    updaterMocks.checkForAppUpdate.mockResolvedValue(null);
    apiMocks.getLauncherState.mockResolvedValue(launcherState);
    apiMocks.getPlannerLogs.mockResolvedValue([]);
    apiMocks.getPlannerRuns.mockResolvedValue([]);
    apiMocks.getRecentProjects.mockResolvedValue([recentProject]);
    apiMocks.refreshManagedBlenderExtensions.mockResolvedValue(1);
    apiMocks.getRunningBlenders.mockResolvedValue([]);
    apiMocks.getRunningBlenderLogs.mockResolvedValue([]);
    apiMocks.getBlenderReleaseDownloads.mockResolvedValue(releaseListing);
    apiMocks.getBlenderConfigs.mockResolvedValue([]);
    apiMocks.saveBlenderConfig.mockResolvedValue(undefined);
    apiMocks.applyBlenderConfig.mockResolvedValue(undefined);
    apiMocks.removeBlenderConfig.mockResolvedValue(undefined);
    apiMocks.stopRunningBlender.mockResolvedValue(undefined);
    apiMocks.installBlenderRelease.mockResolvedValue(launcherState);
    apiMocks.cancelBlenderReleaseInstall.mockResolvedValue(undefined);
    apiMocks.launchBlender.mockResolvedValue(launcherState);
    apiMocks.launchBlenderProject.mockResolvedValue(launcherState);
    apiMocks.pickPlannerBlendFile.mockResolvedValue(null);
    apiMocks.pickPlannerBlenderExecutable.mockResolvedValue(null);
    apiMocks.pickPlannerOutputFolder.mockResolvedValue(null);
    apiMocks.createPlannerRun.mockResolvedValue(undefined);
    apiMocks.deletePlannerRun.mockResolvedValue(undefined);
    apiMocks.updatePlannerRun.mockResolvedValue(undefined);
    apiMocks.removeRecentProject.mockResolvedValue([]);
    apiMocks.removeBlenderVersion.mockResolvedValue({ ...launcherState, versions: [] });
  });

  it("refreshes home data when uninstalling after switching back to the home page", async () => {
    localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify([stableDownload.version]));

    render(<App />);

    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Releases" }));
    await screen.findByText("Stable builds for Windows x64");

    fireEvent.click(screen.getByText("Installed").closest("button") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    const launcherCallsBeforeConfirm = apiMocks.getLauncherState.mock.calls.length;
    const recentCallsBeforeConfirm = apiMocks.getRecentProjects.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Remove version" }));

    await waitFor(() => {
      expect(apiMocks.removeBlenderVersion).toHaveBeenCalledWith(installedVersion.id);
    });

    await waitFor(() => {
      expect(apiMocks.getLauncherState.mock.calls.length).toBeGreaterThan(launcherCallsBeforeConfirm);
      expect(apiMocks.getRecentProjects.mock.calls.length).toBeGreaterThan(recentCallsBeforeConfirm);
    });
  });

  it("renders the update toast without an install button while the download is in progress", async () => {
    const downloadDeferred = createDeferred<void>();
    const downloadAndInstall = vi.fn(async (onEvent?: (event: { event: string; data?: Record<string, number> }) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 25 } });
      await downloadDeferred.promise;
      onEvent?.({ event: "Finished" });
    });

    updaterMocks.checkForAppUpdate.mockResolvedValue({
      currentVersion: "1.0.0",
      version: "1.1.0",
      date: "2026-03-20",
      body: "Fresh fixes and polish.",
      rawJson: {},
      close: vi.fn(),
      downloadAndInstall,
    });

    render(<App />);

    await screen.findByText("Voxel Shift 1.1.0 is ready");
    fireEvent.click(screen.getAllByRole("button", { name: "Update to v1.1.0" })[0]);

    await screen.findByText("25% downloaded");
    expect(screen.queryByRole("button", { name: /Update to v1.1.0|Retry update|Install update/ })).not.toBeInTheDocument();

    downloadDeferred.resolve();
    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    });
  });

  it("closes a discovered updater resource when the app unmounts before the update check finishes", async () => {
    const updateCheck = createDeferred<{
      currentVersion: string;
      version: string;
      date: string;
      body: string;
      rawJson: Record<string, unknown>;
      close: ReturnType<typeof vi.fn>;
      downloadAndInstall: ReturnType<typeof vi.fn>;
    } | null>();
    const close = vi.fn();

    updaterMocks.checkForAppUpdate.mockImplementation(() => updateCheck.promise);

    const { unmount } = render(<App />);
    unmount();

    updateCheck.resolve({
      currentVersion: "1.0.0",
      version: "1.1.0",
      date: "2026-03-20",
      body: "Fresh fixes and polish.",
      rawJson: {},
      close,
      downloadAndInstall: vi.fn(),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("surfaces planner picker, scheduling, update, and log-loading failures", async () => {
    apiMocks.getPlannerRuns.mockResolvedValue([plannerRun]);
    apiMocks.getPlannerLogs.mockRejectedValue({ message: "Planner log service offline" });
    apiMocks.pickPlannerBlendFile.mockRejectedValue({ message: "Blend picker failed" });
    apiMocks.pickPlannerBlenderExecutable.mockRejectedValue({ message: "Blender picker failed" });
    apiMocks.pickPlannerOutputFolder.mockRejectedValue({ message: "Output picker failed" });
    apiMocks.createPlannerRun.mockRejectedValue({ message: "Schedule failed" });
    apiMocks.updatePlannerRun.mockRejectedValue({ message: "Update failed" });

    render(<App />);

    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    await screen.findByText("Planned and past renders");

    fireEvent.click(screen.getAllByRole("button", { name: "Schedule" })[0]);

    const scheduleDialog = await screen.findByRole("dialog", { name: "Schedule a background animation render" });
    fireEvent.click(within(scheduleDialog).getByRole("button", { name: "Browse blend file" }));
    await screen.findByText("Blend picker failed");

    fireEvent.click(within(scheduleDialog).getByRole("tab", { name: "Custom build" }));
    fireEvent.click(within(scheduleDialog).getByRole("button", { name: "Browse custom Blender executable" }));
    await screen.findByText("Blender picker failed");

    fireEvent.change(within(scheduleDialog).getByLabelText("Blend file"), { target: { value: plannerRun.blendFilePath } });
    fireEvent.change(within(scheduleDialog).getByLabelText("Custom Blender executable"), {
      target: { value: "D:\\Tools\\Custom Blender\\blender.exe" },
    });
    fireEvent.click(within(scheduleDialog).getByLabelText("Override output folder"));
    fireEvent.click(within(scheduleDialog).getByRole("button", { name: "Browse output folder" }));
    await screen.findByText("Output picker failed");

    fireEvent.change(within(scheduleDialog).getByLabelText("Output folder"), { target: { value: "D:\\Renders\\Shot_999" } });
    fireEvent.click(within(scheduleDialog).getByRole("button", { name: "Schedule render" }));

    await screen.findByText("Schedule failed");

    fireEvent.click(within(scheduleDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Schedule a background animation render" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit render-scene.blend" }));

    const editDialog = await screen.findByRole("dialog", { name: "Edit a planned background animation render" });
    fireEvent.change(within(editDialog).getByLabelText("End frame"), { target: { value: "180" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save changes" }));

    await screen.findByText("Update failed");
    fireEvent.click(within(editDialog).getByRole("button", { name: "Cancel" }));

    emitPlannerRuns([
      {
        ...plannerRun,
        status: "running",
        startedAt: plannerRun.startAt,
        currentFrame: 4,
        renderedFrameCount: 4,
        averageRenderTimeSeconds: 3,
        estimatedRemainingSeconds: 348,
        pid: 4242,
      },
    ]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open logs for render-scene.blend" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open logs for render-scene.blend" }));
    expect(await screen.findByText("Planner log service offline")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "render-scene.blend" })).not.toBeInTheDocument();
    });

  });

  it("shows planner load failures and safely falls back when running Blender discovery fails", async () => {
    apiMocks.getRunningBlenders.mockRejectedValueOnce(new Error("Running Blender discovery failed"));
    apiMocks.getPlannerRuns.mockRejectedValueOnce({ message: "Planner service offline" });

    render(<App />);

    await screen.findByText("Continue where you left off");
    expect(screen.queryByRole("button", { name: /Blender tray/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    await screen.findByText("Planner service offline");
  });

  it("ignores orphaned and duplicate live log events for Blender and planner sessions", async () => {
    apiMocks.getPlannerRuns.mockResolvedValue([{ ...plannerRun, status: "running", startedAt: plannerRun.startAt, pid: 4242 }]);
    apiMocks.getPlannerLogs.mockResolvedValue([]);

    render(<App />);

    await screen.findByText("Continue where you left off");

    emitRunningBlenderLog(runningBlenderLog);
    emitRunningBlenders([runningBlender]);
    emitRunningBlenderLog(runningBlenderLog);
    emitRunningBlenderLog(runningBlenderLog);

    fireEvent.click(await screen.findByRole("button", { name: /Blender tray/ }));
    fireEvent.click(screen.getByRole("button", { name: "View live logs" }));

    const blenderLogsDialog = await screen.findByRole("dialog", { name: "Blender 4.2.3" });
    expect(within(blenderLogsDialog).getAllByText("Loading startup file")).toHaveLength(1);
    fireEvent.click(within(blenderLogsDialog).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    await screen.findByText("Planned and past renders");
    fireEvent.click(screen.getByRole("button", { name: "Open logs for render-scene.blend" }));

    await waitFor(() => {
      expect(apiMocks.getPlannerLogs).toHaveBeenCalledWith(plannerRun.id);
    });

    emitPlannerLog(plannerLog);
    emitPlannerLog(plannerLog);

    const plannerLogsDialog = await screen.findByRole("dialog", { name: "render-scene.blend" });
    expect(within(plannerLogsDialog).getAllByText("Fra:1 Mem:30.00M")).toHaveLength(1);
  });
});
