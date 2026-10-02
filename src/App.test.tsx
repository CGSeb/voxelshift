import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  BlenderConfigProfile,
  BlenderLogEntry,
  BlenderReleaseDownload,
  BlenderReleaseInstallProgress,
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
  getMcpSettings: vi.fn(),
  setMcpSettings: vi.fn(),
  applyBlenderConfig: vi.fn(),
  cancelBlenderReleaseInstall: vi.fn(),
  createPlannerRun: vi.fn(),
  cancelPlannerRun: vi.fn(),
  retryPlannerRun: vi.fn(),
  getPlannerQueue: vi.fn(),
  setPlannerQueuePaused: vi.fn(),
  reorderPlannerQueue: vi.fn(),
  deletePlannerRun: vi.fn(),
  updatePlannerRun: vi.fn(),
  getBlenderConfigs: vi.fn(),
  getBlenderLtsReleaseLines: vi.fn(),
  getBlenderReleaseDownloads: vi.fn(),
  getLauncherState: vi.fn(),
  getPlannerLogs: vi.fn(),
  getPlannerRuns: vi.fn(),
  getRecentProjects: vi.fn(),
  refreshManagedBlenderExtensions: vi.fn(),
  getRunningBlenderLogs: vi.fn(),
  getRunningBlenders: vi.fn(),
  installBlenderRelease: vi.fn(),
  getInstallMigrationFolders: vi.fn(),
  getInstallMigrationLinks: vi.fn(),
  pickInstallMigrationFolder: vi.fn(),
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
  executablePath: "D:\\\Blender\\blender.exe",
  installDir: "D:\\\Users\\Sebastien\\Documents\\VoxelShift\\stable\\Blender 4.2.3",
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

const pendingDownload: BlenderReleaseDownload = {
  id: "release-new",
  channel: "Blender4.3",
  version: "4.3.0",
  fileName: "blender-4.3.0-windows-x64.zip",
  releaseDate: "2026-03-21",
  url: "https://download.blender.org/release/Blender4.3/blender-4.3.0-windows-x64.zip",
};

const releaseListing: BlenderReleaseListing = {
  platformLabel: "Windows x64",
  stableDownloads: [stableDownload, pendingDownload],
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

const savedConfig: BlenderConfigProfile = {
  id: "Studio",
  name: "Studio",
  path: "D:\\Users\\Sebastien\\Documents\\VoxelShift\\configs\\Studio",
  updatedAt: 1,
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

const updatedPlannerRun: PlannerRunSummary = {
  ...plannerRun,
  endFrame: 180,
  outputFolderPath: "D:\\Renders\\Shot_010",
};

const plannerLog: PlannerLogEntry = {
  id: "planner-1-0",
  runId: plannerRun.id,
  source: "stdout",
  message: "Fra:1 Mem:30.00M",
  timestamp: 2,
};

const releaseInstallEvent = "release-install-progress";
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

function emitInstallProgress(progress: BlenderReleaseInstallProgress) {
  emitTauriEvent(releaseInstallEvent, progress);
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

describe("App", () => {
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
    apiMocks.getMcpSettings.mockResolvedValue({ enabled: false, running: false, port: 47831, token: "test-token", error: null });
    apiMocks.getPlannerLogs.mockResolvedValue([plannerLog]);
    apiMocks.getPlannerRuns.mockResolvedValue([]);
    apiMocks.getPlannerQueue.mockResolvedValue({ paused: false, pendingRunIds: [] });
    apiMocks.getRecentProjects.mockResolvedValue([recentProject]);
    apiMocks.refreshManagedBlenderExtensions.mockResolvedValue(1);
    apiMocks.getRunningBlenders.mockResolvedValue([]);
    apiMocks.getRunningBlenderLogs.mockResolvedValue([runningBlenderLog]);
    apiMocks.getBlenderLtsReleaseLines.mockResolvedValue(["4.2"]);
    apiMocks.getBlenderReleaseDownloads.mockResolvedValue(releaseListing);
    apiMocks.getBlenderConfigs.mockResolvedValue([savedConfig]);
    apiMocks.saveBlenderConfig.mockResolvedValue(savedConfig);
    apiMocks.applyBlenderConfig.mockResolvedValue(undefined);
    apiMocks.removeBlenderConfig.mockResolvedValue(undefined);
    apiMocks.stopRunningBlender.mockResolvedValue(undefined);
    apiMocks.installBlenderRelease.mockResolvedValue(launcherState);
    apiMocks.getInstallMigrationFolders.mockResolvedValue({ settingsPath: "D:/previous/portable/config", extensionsPath: "D:/previous/portable/extensions", addonsPath: null });
    apiMocks.getInstallMigrationLinks.mockResolvedValue([]);
    apiMocks.cancelBlenderReleaseInstall.mockResolvedValue(undefined);
    apiMocks.launchBlender.mockResolvedValue(launcherState);
    apiMocks.launchBlenderProject.mockResolvedValue(launcherState);
    apiMocks.pickPlannerBlendFile.mockResolvedValue(null);
    apiMocks.pickPlannerBlenderExecutable.mockResolvedValue(null);
    apiMocks.pickPlannerOutputFolder.mockResolvedValue(null);
    apiMocks.createPlannerRun.mockResolvedValue(plannerRun);
    apiMocks.deletePlannerRun.mockResolvedValue(undefined);
    apiMocks.updatePlannerRun.mockResolvedValue(updatedPlannerRun);
    apiMocks.removeRecentProject.mockResolvedValue([]);
    apiMocks.removeBlenderVersion.mockResolvedValue({ ...launcherState, versions: [] });
  });

  it("pauses and resumes the queue and reflects MCP queue changes", async () => {
    render(<App />);
    await screen.findByText("Continue where you left off");
    await waitFor(() => expect(apiMocks.getPlannerQueue).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    apiMocks.getPlannerQueue.mockResolvedValue({ paused: true, pendingRunIds: [] });
    apiMocks.setPlannerQueuePaused.mockResolvedValue({ paused: true, pendingRunIds: [] });
    fireEvent.click(screen.getByRole("button", { name: "Pause queue" }));
    await screen.findByRole("button", { name: "Resume queue" });
    expect(apiMocks.setPlannerQueuePaused).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Resume queue" })).toBeEnabled());
    apiMocks.getPlannerQueue.mockResolvedValue({ paused: false, pendingRunIds: [] });
    fireEvent.click(screen.getByRole("button", { name: "Resume queue" }));
    await screen.findByRole("button", { name: "Pause queue" });
    expect(apiMocks.setPlannerQueuePaused).toHaveBeenLastCalledWith(false);
    act(() => emitTauriEvent("planner-queue-updated", { paused: true, pendingRunIds: [] }));
    expect(screen.getByRole("button", { name: "Resume queue" })).toBeInTheDocument();
  });

  it("keeps a live queue update when an older initial snapshot arrives later", async () => {
    const snapshot = createDeferred<{ paused: boolean; pendingRunIds: string[] }>();
    apiMocks.getPlannerQueue.mockReturnValueOnce(snapshot.promise);
    render(<App />);
    await waitFor(() => expect(apiMocks.getPlannerQueue).toHaveBeenCalled());
    act(() => emitTauriEvent("planner-queue-updated", { paused: true, pendingRunIds: [plannerRun.id] }));
    await act(async () => snapshot.resolve({ paused: false, pendingRunIds: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    expect(await screen.findByRole("button", { name: "Resume queue" })).toBeInTheDocument();
  });

  it("reports queue subscription failures", async () => {
    tauriMocks.listen.mockImplementation(async (name: string) => {
      if (name === "planner-queue-updated") throw new Error("Queue subscription unavailable");
      return vi.fn();
    });
    render(<App />);
    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    expect(await screen.findByText("Queue subscription unavailable")).toBeInTheDocument();
  });

  it.each(["planner-queue-updated", "planner-run-finished"])("releases a late %s subscription after unmount", async (eventName) => {
    const subscription = createDeferred<() => void>();
    const unlisten = vi.fn();
    tauriMocks.listen.mockImplementation((name: string) => name === eventName ? subscription.promise : Promise.resolve(vi.fn()));
    const { unmount } = render(<App />);
    await waitFor(() => expect(tauriMocks.listen).toHaveBeenCalledWith(eventName, expect.any(Function)));
    unmount();
    await act(async () => subscription.resolve(unlisten));
    expect(unlisten).toHaveBeenCalledOnce();
    expect(apiMocks.getPlannerQueue).not.toHaveBeenCalled();
  });

  it("disables queue controls until an in-flight pause completes", async () => {
    const operation = createDeferred<void>();
    apiMocks.setPlannerQueuePaused.mockReturnValueOnce(operation.promise);
    render(<App />);
    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pause queue" }));
    expect(screen.getByRole("button", { name: "Pause queue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Pause queue" }));
    expect(apiMocks.setPlannerQueuePaused).toHaveBeenCalledOnce();
    apiMocks.getPlannerQueue.mockResolvedValue({ paused: true, pendingRunIds: [] });
    await act(async () => operation.resolve());
    expect(await screen.findByRole("button", { name: "Resume queue" })).toBeEnabled();
  });

  it("reorders the pending queue and exposes failures without announcing success", async () => {
    const second = { ...plannerRun, id: "second", blendFilePath: "D:/second.blend" };
    apiMocks.getPlannerRuns.mockResolvedValue([plannerRun, second]);
    apiMocks.getPlannerQueue.mockResolvedValue({ paused: false, pendingRunIds: [plannerRun.id, second.id] });
    apiMocks.reorderPlannerQueue.mockResolvedValue(undefined);
    render(<App />);
    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Move second.blend up" }));
    await screen.findByText("Queue order updated.");
    expect(apiMocks.reorderPlannerQueue).toHaveBeenCalledWith([second.id, plannerRun.id]);
    apiMocks.setPlannerQueuePaused.mockRejectedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Pause queue" }));
    expect(await screen.findByText("Could not control this render queue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause queue" })).toBeEnabled();
    expect(screen.queryByText("Queue paused.")).not.toBeInTheDocument();
  });

  it("dismisses retry confirmation without starting another render", async () => {
    apiMocks.getPlannerRuns.mockResolvedValue([{ ...plannerRun, status: "cancelled" }]);
    render(<App />);
    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry render-scene.blend" }));
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("shut down the computer");
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(apiMocks.retryPlannerRun).not.toHaveBeenCalled();
  });

  it("deduplicates finished notifications, limits their history, and opens their logs", async () => {
    render(<App />);
    await waitFor(() => expect(tauriMocks.listen).toHaveBeenCalledWith("planner-run-finished", expect.any(Function)));
    act(() => {
      for (let index = 0; index < 7; index++) {
        emitTauriEvent("planner-run-finished", { ...plannerRun, id: `run-${index}`, blendFilePath: `D:/scene-${index}.blend`, status: "completed" });
      }
      emitTauriEvent("planner-run-finished", { ...plannerRun, id: "run-6", blendFilePath: "D:/scene-6.blend", status: "failed", lastErrorMessage: "Output unavailable" });
    });
    const notifications = screen.getByRole("complementary", { name: "Render notifications" });
    expect(within(notifications).getAllByRole("button", { name: "View render logs" })).toHaveLength(5);
    expect(within(notifications).queryByText("scene-1.blend")).not.toBeInTheDocument();
    expect(within(notifications).getAllByText("scene-6.blend")).toHaveLength(1);
    fireEvent.click(within(within(notifications).getByRole("alert")).getByRole("button", { name: "View render logs" }));
    expect(await screen.findByRole("dialog", { name: "scene-6.blend" })).toBeInTheDocument();
    expect(apiMocks.getPlannerLogs).toHaveBeenCalledWith("run-6");
  });

  it("confirms cancellation of an active render and refreshes its terminal status", async () => {
    apiMocks.getPlannerRuns.mockResolvedValue([{ ...plannerRun, status: "running", pid: 4242 }]);
    apiMocks.cancelPlannerRun.mockResolvedValue(undefined);
    render(<App />);
    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel render-scene.blend" }));
    expect(apiMocks.cancelPlannerRun).not.toHaveBeenCalled();
    expect(screen.getByText(/Frames already written to disk will be kept/)).toBeInTheDocument();
    apiMocks.getPlannerRuns.mockResolvedValue([{ ...plannerRun, status: "cancelled" }]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel render" }));
    await screen.findByText("Cancelled");
    expect(apiMocks.cancelPlannerRun).toHaveBeenCalledWith(plannerRun.id);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps a failed cancel confirmation open and displays the backend error", async () => {
    apiMocks.getPlannerRuns.mockResolvedValue([plannerRun]);
    apiMocks.cancelPlannerRun.mockRejectedValue(new Error("Unable to stop process"));
    render(<App />);
    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel render-scene.blend" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel render" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText("Unable to stop process")).toBeInTheDocument());
  });

  it("confirms retry output replacement and inherited shutdown before creating a new attempt", async () => {
    apiMocks.getPlannerRuns.mockResolvedValue([{ ...plannerRun, status: "failed", shutdownWhenDone: true }]);
    apiMocks.retryPlannerRun.mockResolvedValue({ ...plannerRun, id: "retry-1" });
    render(<App />);
    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry render-scene.blend" }));
    expect(screen.getByText(/Existing output files may be overwritten/)).toBeInTheDocument();
    expect(screen.getByText(/shut down the computer/)).toBeInTheDocument();
    expect(apiMocks.retryPlannerRun).not.toHaveBeenCalled();
    apiMocks.getPlannerRuns.mockResolvedValue([{ ...plannerRun, id: "retry-1" }, { ...plannerRun, status: "failed" }]);
    apiMocks.getPlannerQueue.mockResolvedValue({ paused: false, pendingRunIds: ["retry-1"] });
    fireEvent.click(screen.getByRole("button", { name: "Retry render" }));
    await screen.findByText("Retry added to the queue.");
    expect(apiMocks.retryPlannerRun).toHaveBeenCalledWith(plannerRun.id);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows completion and failure notifications from any page and can dismiss them", async () => {
    render(<App />);
    await screen.findByText("Continue where you left off");
    await waitFor(() => expect(tauriMocks.listen).toHaveBeenCalledWith("planner-run-finished", expect.any(Function)));
    act(() => emitTauriEvent("planner-run-finished", { ...plannerRun, status: "completed" }));
    const notifications = screen.getByRole("complementary", { name: "Render notifications" });
    expect(within(notifications).getByText("Render completed")).toBeInTheDocument();
    act(() => emitTauriEvent("planner-run-finished", { ...plannerRun, id: "failure-2", status: "failed", lastErrorMessage: "Blender crashed" }));
    expect(within(notifications).getByRole("alert")).toHaveTextContent("Blender crashed");
    expect(within(notifications).getAllByRole("button", { name: "View render logs" })).toHaveLength(2);
    fireEvent.click(within(notifications).getAllByRole("button", { name: "Dismiss notification for render-scene.blend" })[0]);
    expect(within(notifications).queryByText("Render completed")).not.toBeInTheDocument();
    expect(within(notifications).getByText("Render failed")).toBeInTheDocument();
  });

  it("loads the home page and migrates legacy favorites after opening releases", async () => {
    localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify([stableDownload.id, stableDownload.version, " "]));

    render(<App />);

    await screen.findByText("Continue where you left off");
    expect(screen.getByRole("button", { name: "Launch Blender 4.2.3" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Releases" }));

    await screen.findByText("Stable builds for Windows x64");
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(favoriteReleaseStorageKey) ?? "[]")).toEqual([stableDownload.version]);
    });
  });

  it("reflects launcher state changes from MCP in the UI", async () => {
    localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify([stableDownload.version]));
    render(<App />);
    await screen.findByRole("button", { name: "Launch Blender 4.2.3" });
    act(() => emitTauriEvent("launcher-state-updated", {
      ...launcherState,
      versions: [{ ...installedVersion, displayName: "Blender MCP launch" }],
    }));
    expect(await screen.findByRole("button", { name: "Launch Blender MCP launch" })).toBeInTheDocument();
  });

  it("opens MCP settings from the footer and closes without saving", async () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "MCP: disabled. Open settings" }));
    expect(await screen.findByRole("switch", { name: "Enable MCP server" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "MCP connection" })).not.toBeInTheDocument();
    expect(apiMocks.setMcpSettings).not.toHaveBeenCalled();
  });

  it("refreshes recent projects after an MCP history update", async () => {
    render(<App />);
    await screen.findByText("Test Scene");
    act(() => emitTauriEvent("recent-projects-updated", []));
    expect(screen.queryByText("Test Scene")).not.toBeInTheDocument();
  });

  it("shows updater details and completes an in-app update install", async () => {
    const close = vi.fn();
    const downloadAndInstall = vi.fn(async (onEvent?: (event: { event: string; data?: Record<string, number> }) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 25 } });
      onEvent?.({ event: "Finished" });
    });

    updaterMocks.checkForAppUpdate.mockResolvedValue({
      currentVersion: "1.0.0",
      version: "1.1.0",
      date: "2026-03-20",
      body: "Fresh fixes and polish.",
      rawJson: {},
      close,
      downloadAndInstall,
    });

    render(<App />);

    await screen.findByText("Voxel Shift 1.1.0 is ready");
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.queryByText("Update v1.1.0 available")).not.toBeInTheDocument();
    expect(screen.queryByText("Latest v1.1.0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Update to v1.1.0" })[0]);

    await screen.findByText("Voxel Shift 1.1.0 installed");
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(apiMocks.refreshManagedBlenderExtensions).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Installed")).toBeInTheDocument();
  });

  it("surfaces home, release, app version, and updater failures", async () => {
    localStorage.setItem(favoriteReleaseStorageKey, "{broken-json");
    tauriMocks.getVersion.mockRejectedValue(new Error("Version lookup failed"));
    updaterMocks.checkForAppUpdate.mockRejectedValue("Update service offline");
    apiMocks.getLauncherState.mockRejectedValue("Versions failed");
    apiMocks.getRecentProjects.mockRejectedValue("Projects failed");
    apiMocks.getBlenderReleaseDownloads.mockRejectedValue(new Error("Releases failed"));

    render(<App />);

    await screen.findByText("Projects failed");
    expect(screen.getByText("Version unavailable")).toBeInTheDocument();
    expect(screen.getByText("Updates unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Releases" }));
    await screen.findByText("Releases failed");
  });

  it("shows install failures for new releases", async () => {
    apiMocks.installBlenderRelease.mockRejectedValue(new Error("Download failed"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Releases" }));
    await screen.findByText("Stable builds for Windows x64");

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(apiMocks.installBlenderRelease).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Install fresh" }));

    await screen.findByText("Download failed");
  });

  it("navigates from the empty home state to releases, refreshes the list, and launches installed builds", async () => {
    apiMocks.getRecentProjects.mockResolvedValue([]);

    render(<App />);

    await screen.findByText("Start by adding a Blender release");
    fireEvent.click(screen.getByRole("button", { name: "Browse releases" }));

    await screen.findByText("Stable builds for Windows x64");
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));

    await waitFor(() => {
      expect(apiMocks.getBlenderReleaseDownloads.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch Blender 4.2.3" }));

    await waitFor(() => {
      expect(apiMocks.launchBlender).toHaveBeenCalledWith({ id: installedVersion.id });
    });
  });

  it("handles canceled installs, progress cleanup, and cancel failures", async () => {
    apiMocks.installBlenderRelease.mockRejectedValueOnce("Installation canceled.");
    apiMocks.cancelBlenderReleaseInstall.mockRejectedValueOnce(new Error("Cancel failed"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Releases" }));
    await screen.findByText("Stable builds for Windows x64");

    const pendingReleaseRow = screen.getByText("4.3.0").closest("article") as HTMLElement;
    fireEvent.click(within(pendingReleaseRow).getByRole("button", { name: "Install" }));
    fireEvent.click(await screen.findByRole("button", { name: "Install fresh" }));

    await waitFor(() => {
      expect(within(pendingReleaseRow).queryByText("Could not install Blender 4.3.0.")).not.toBeInTheDocument();
    });

    emitInstallProgress({
      releaseId: pendingDownload.id,
      phase: "downloading",
      progressPercent: 50,
      downloadedBytes: 512,
      totalBytes: 1024,
      speedBytesPerSecond: 128,
      installDir: null,
      message: "Downloading Blender 4.3.0",
    });
    await screen.findByText("Downloading Blender 4.3.0");

    emitInstallProgress({
      releaseId: pendingDownload.id,
      phase: "completed",
      progressPercent: 100,
      downloadedBytes: 1024,
      totalBytes: 1024,
      speedBytesPerSecond: null,
      installDir: "D:\\\VoxelShift\\stable\\Blender 4.3.0",
      message: "Done",
    });
    await waitFor(() => {
      expect(screen.queryByText("Downloading Blender 4.3.0")).not.toBeInTheDocument();
    });

    emitInstallProgress({
      releaseId: pendingDownload.id,
      phase: "downloading",
      progressPercent: 25,
      downloadedBytes: 256,
      totalBytes: 1024,
      speedBytesPerSecond: 64,
      installDir: null,
      message: "Downloading Blender 4.3.0",
    });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await screen.findByText("Cancel failed");

    emitInstallProgress({
      releaseId: pendingDownload.id,
      phase: "canceled",
      progressPercent: null,
      downloadedBytes: 0,
      totalBytes: null,
      speedBytesPerSecond: null,
      installDir: null,
      message: "Canceled",
    });
    await waitFor(() => {
      expect(screen.queryByText("Cancel failed")).not.toBeInTheDocument();
    });
  });

  it("shows launch and recent project errors on the home page", async () => {
    localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify([stableDownload.version]));
    apiMocks.launchBlender.mockRejectedValueOnce("Launch failed");
    apiMocks.launchBlenderProject.mockRejectedValueOnce(new Error("Project failed"));

    render(<App />);

    await screen.findByText("Continue where you left off");

    fireEvent.click(screen.getByRole("button", { name: "Launch Blender 4.2.3" }));
    await screen.findByText("Launch failed");

    fireEvent.click(screen.getByRole("button", { name: "Open Test Scene" }));
    await screen.findByText("Project failed");
  });

  it("keeps the uninstall dialog open and shows an error when removal fails", async () => {
    localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify([stableDownload.version]));
    apiMocks.removeBlenderVersion.mockRejectedValueOnce(new Error("Remove failed"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Releases" }));
    await screen.findByText("Stable builds for Windows x64");

    fireEvent.click(screen.getByText("Installed").closest("button") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Remove version" }));

    await screen.findByText("Remove failed");
    expect(screen.getByText("Remove Blender 4.2.3?")).toBeInTheDocument();
  });

  it("retries failed app updates after reopening the toast", async () => {
    const close = vi.fn();
    const downloadAndInstall = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("Updater failed");
      })
      .mockImplementationOnce(async (onEvent?: (event: { event: string; data?: Record<string, number> }) => void) => {
        onEvent?.({ event: "Started", data: { contentLength: 100 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 100 } });
        onEvent?.({ event: "Finished" });
      });

    updaterMocks.checkForAppUpdate.mockResolvedValue({
      currentVersion: "1.0.0",
      version: "1.1.0",
      date: "2026-03-20",
      body: "Fresh fixes and polish.",
      rawJson: {},
      close,
      downloadAndInstall,
    });

    render(<App />);

    await screen.findByText("Voxel Shift 1.1.0 is ready");
    fireEvent.click(screen.getAllByRole("button", { name: "Update to v1.1.0" })[0]);

    await screen.findByText("Updater failed");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Retry update" })[0]);

    await screen.findByText("Voxel Shift 1.1.0 installed");
    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(apiMocks.refreshManagedBlenderExtensions).toHaveBeenCalledTimes(1);
  });

  it("cancels release installs and removes installed versions through the confirm dialog", async () => {
    localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify([stableDownload.version]));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Releases" }));
    await screen.findByText("Stable builds for Windows x64");

    emitInstallProgress({
      releaseId: pendingDownload.id,
      phase: "downloading",
      progressPercent: 50,
      downloadedBytes: 512,
      totalBytes: 1024,
      speedBytesPerSecond: 128,
      installDir: null,
      message: "Downloading Blender 4.3.0",
    });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(apiMocks.cancelBlenderReleaseInstall).toHaveBeenCalledWith(pendingDownload.id);
    });

    fireEvent.click(screen.getByText("Installed").closest("button") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Remove version" }));

    await waitFor(() => {
      expect(apiMocks.removeBlenderVersion).toHaveBeenCalledWith(installedVersion.id);
    });
    await waitFor(() => {
      expect(localStorage.getItem(favoriteReleaseStorageKey)).toBe("[]");
    });
  });

  it("shows running Blender sessions, opens live logs, and stops a session after confirmation", async () => {
    render(<App />);

    await screen.findByText("Continue where you left off");

    emitRunningBlenders([runningBlender]);
    expect(await screen.findByText("1 running")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Blender tray/ }));
    expect(await screen.findByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View live logs" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View live logs" }));

    await waitFor(() => {
      expect(apiMocks.getRunningBlenderLogs).toHaveBeenCalledWith(runningBlender.instanceId);
    });
    expect(await screen.findByText("Loading startup file")).toBeInTheDocument();

    emitRunningBlenderLog({
      id: "session-1-1",
      instanceId: runningBlender.instanceId,
      source: "stderr",
      message: "Runtime warning",
      timestamp: 2,
    });
    expect(await screen.findByText("Runtime warning")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Stop Blender" }));
    const stopDialog = await screen.findByRole("alertdialog");
    expect(within(stopDialog).getByText("Stop Blender 4.2.3?")).toBeInTheDocument();
    fireEvent.click(within(stopDialog).getByRole("button", { name: "Stop Blender" }));

    await waitFor(() => {
      expect(apiMocks.stopRunningBlender).toHaveBeenCalledWith(runningBlender.instanceId);
    });
  });

  it("keeps only the latest closed session per version/project and normalizes Windows paths", async () => {
    const firstRunningBlender: RunningBlenderProcess = {
      ...runningBlender,
      projectPath: "D:\\Projects\\SharedScene.blend",
    };
    const secondRunningBlender: RunningBlenderProcess = {
      ...runningBlender,
      instanceId: "session-2",
      pid: 4343,
      startedAt: 2,
      projectPath: "D:/Projects/SharedScene.blend",
    };
    const thirdRunningBlender: RunningBlenderProcess = {
      ...runningBlender,
      instanceId: "session-3",
      pid: 4444,
      startedAt: 3,
      projectPath: "d:\\projects\\sharedscene.blend",
    };

    render(<App />);

    await screen.findByText("Continue where you left off");

    emitRunningBlenders([firstRunningBlender]);
    emitRunningBlenderLog({
      ...runningBlenderLog,
      instanceId: firstRunningBlender.instanceId,
    });

    emitRunningBlenders([secondRunningBlender]);
    emitRunningBlenderLog({
      ...runningBlenderLog,
      id: "session-2-0",
      instanceId: secondRunningBlender.instanceId,
      message: "Second session log",
      timestamp: 2,
    });

    emitRunningBlenders([thirdRunningBlender]);
    emitRunningBlenderLog({
      ...runningBlenderLog,
      id: "session-3-0",
      instanceId: thirdRunningBlender.instanceId,
      message: "Third session log",
      timestamp: 3,
    });

    emitRunningBlenders([]);

    expect(await screen.findByText("1 recent session")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Blender tray/ }));

    expect(screen.queryByText("4242")).not.toBeInTheDocument();
    expect(screen.queryByText("4343")).not.toBeInTheDocument();
    expect(screen.getByText("4444")).toBeInTheDocument();
    expect(screen.getAllByText("Closed")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "View logs" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Stop Blender" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View logs" }));

    expect(apiMocks.getRunningBlenderLogs).not.toHaveBeenCalled();
    expect(await screen.findByText("Third session log")).toBeInTheDocument();
  });
  it("opens the config menu, saves the current config, applies an existing one, and removes one after confirmation", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Releases" }));
    await screen.findByText("Stable builds for Windows x64");

    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save config" }));

    await screen.findByRole("dialog", { name: "Blender 4.2.3" });
    expect(apiMocks.getBlenderConfigs).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Config name"), { target: { value: "Studio" } });
    fireEvent.click(screen.getByRole("button", { name: "Save current config" }));

    await waitFor(() => {
      expect(apiMocks.saveBlenderConfig).toHaveBeenCalledWith({
        versionId: installedVersion.id,
        name: "Studio",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply a config" }));

    await screen.findByRole("dialog", { name: "Blender 4.2.3" });
    await waitFor(() => {
      expect(apiMocks.getBlenderConfigs).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(apiMocks.applyBlenderConfig).toHaveBeenCalledWith({
        versionId: installedVersion.id,
        configId: savedConfig.id,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply a config" }));

    await screen.findByRole("dialog", { name: "Blender 4.2.3" });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("Remove Studio?");
    fireEvent.click(screen.getByRole("button", { name: "Remove config" }));

    await waitFor(() => {
      expect(apiMocks.removeBlenderConfig).toHaveBeenCalledWith(savedConfig.id);
    });
  });
  it("toggles favorites, opens projects, and marks newly installed releases as installed", async () => {
    const experimentalDownload: BlenderReleaseDownload = {
      id: "release-exp",
      channel: "Blender 4.4 Alpha",
      version: "4.4.0",
      fileName: "blender-4.4.0-alpha-windows-x64.zip",
      releaseDate: "2026-03-22",
      url: "https://download.blender.org/release/Blender4.4/blender-4.4.0-alpha-windows-x64.zip",
    };

    const experimentalVersion: BlenderVersion = {
      ...installedVersion,
      id: "version-44",
      displayName: "Blender 4.4.0",
      version: "4.4.0",
      installDir: "D:\\Users\\Sebastien\\Documents\\VoxelShift\\stable\\Blender 4.4.0",
    };

    apiMocks.getBlenderReleaseDownloads.mockResolvedValue({
      ...releaseListing,
      experimentalGroups: [
        {
          platformKey: "windows-x64",
          platformLabel: "Windows x64",
          downloads: [experimentalDownload],
        },
      ],
    });
    apiMocks.installBlenderRelease.mockResolvedValue({
      ...launcherState,
      versions: [...launcherState.versions, experimentalVersion],
    });

    render(<App />);

    await screen.findByText("Continue where you left off");

    fireEvent.click(screen.getByRole("button", { name: "Open Test Scene" }));
    await waitFor(() => {
      expect(apiMocks.launchBlenderProject).toHaveBeenCalledWith({
        id: installedVersion.id,
        projectPath: recentProject.filePath,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Releases" }));
    await screen.findByText("Stable builds for Windows x64");

    fireEvent.click(screen.getByRole("button", { name: "Mark 4.2.3 as favorite" }));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(favoriteReleaseStorageKey) ?? "[]")).toEqual([stableDownload.version]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove 4.2.3 from favorites" }));
    await waitFor(() => {
      expect(localStorage.getItem(favoriteReleaseStorageKey)).toBe("[]");
    });

    fireEvent.click(screen.getByRole("tab", { name: "Experimental" }));

    const experimentalRow = await screen.findByText("4.4.0").then((element) => element.closest("article") as HTMLElement);
    fireEvent.click(within(experimentalRow).getByRole("button", { name: "Install" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    fireEvent.click(screen.getByRole("button", { name: "Symlink" }));
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));

    await waitFor(() => {
      expect(apiMocks.installBlenderRelease).toHaveBeenCalledWith({
        id: experimentalDownload.id,
        version: experimentalDownload.version,
        fileName: experimentalDownload.fileName,
        url: experimentalDownload.url,
        migration: { settingsPath: "D:/previous/portable/config", extensionsPath: "D:/previous/portable/extensions", addonsPath: null, extensionMode: "symlink" },
      });
    });

    emitInstallProgress({
      releaseId: experimentalDownload.id,
      phase: "completed",
      progressPercent: 100,
      downloadedBytes: 1024,
      totalBytes: 1024,
      speedBytesPerSecond: null,
      installDir: experimentalVersion.installDir,
      message: "Installed",
    });

    await waitFor(() => {
      expect(within(experimentalRow).getByRole("button", { name: "Launch Blender 4.4.0" })).toBeInTheDocument();
    });
  });

  it("schedules planner renders, shows live planner updates, and opens planner logs", async () => {
    apiMocks.pickPlannerBlendFile.mockResolvedValueOnce(plannerRun.blendFilePath);
    apiMocks.pickPlannerOutputFolder.mockResolvedValueOnce("D:\\Renders\\Shot_010");

    render(<App />);

    await screen.findByText("Continue where you left off");

    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    await screen.findByText("Planned and past renders");

    fireEvent.click(screen.getAllByRole("button", { name: "Schedule" })[0]);
    await screen.findByRole("dialog", { name: "Schedule a background animation render" });

    fireEvent.click(screen.getByRole("button", { name: "Browse blend file" }));
    await waitFor(() => {
      expect(apiMocks.pickPlannerBlendFile).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByLabelText("Override output folder"));
    fireEvent.click(screen.getByRole("button", { name: "Browse output folder" }));

    await waitFor(() => {
      expect(apiMocks.pickPlannerOutputFolder).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Schedule render" }));

    await waitFor(() => {
        expect(apiMocks.createPlannerRun).toHaveBeenCalledWith(
        expect.objectContaining({
          blendFilePath: plannerRun.blendFilePath,
          startFrame: 1,
          endFrame: 250,
          outputFolderPath: "D:\\Renders\\Shot_010",
          shutdownWhenDone: false,
          blender: {
            source: "library",
            versionId: installedVersion.id,
            executablePath: null,
          },
        }),
      );
    });

    expect(screen.getByRole("button", { name: "Edit render-scene.blend" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open logs for render-scene.blend" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit render-scene.blend" }));

    const editDialog = await screen.findByRole("dialog", { name: "Edit a planned background animation render" });
    fireEvent.change(within(editDialog).getByLabelText("End frame"), { target: { value: "180" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
        expect(apiMocks.updatePlannerRun).toHaveBeenCalledWith(
        plannerRun.id,
        expect.objectContaining({
          blendFilePath: plannerRun.blendFilePath,
          startFrame: 1,
          endFrame: 180,
          outputFolderPath: "D:\\Renders\\Shot_010",
          shutdownWhenDone: false,
          blender: {
            source: "library",
            versionId: installedVersion.id,
            executablePath: null,
          },
        }),
      );
    });

    emitPlannerRuns([
      {
        ...updatedPlannerRun,
        status: "running",
        startedAt: updatedPlannerRun.startAt,
        currentFrame: 4,
        renderedFrameCount: 4,
        averageRenderTimeSeconds: 3,
        estimatedRemainingSeconds: 528,
        pid: 4242,
      },
    ]);

    expect(await screen.findByText("Frame 4 of 180")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open logs for render-scene.blend" })).toBeInTheDocument();

    apiMocks.createPlannerRun.mockResolvedValueOnce({
      ...updatedPlannerRun,
      id: "planner-2",
    });

    fireEvent.click(screen.getByRole("button", { name: "Duplicate render-scene.blend" }));

    const duplicateDialog = await screen.findByRole("dialog", { name: "Schedule a background animation render" });
    expect(within(duplicateDialog).getByDisplayValue(updatedPlannerRun.blendFilePath)).toBeInTheDocument();
    expect(within(duplicateDialog).getByDisplayValue("180")).toBeInTheDocument();
    expect(within(duplicateDialog).getByDisplayValue("D:\\Renders\\Shot_010")).toBeInTheDocument();
    expect(within(duplicateDialog).getByLabelText("Override output folder")).toBeChecked();
    expect(within(duplicateDialog).getByLabelText("Shut down computer when render is done")).not.toBeChecked();

    fireEvent.click(within(duplicateDialog).getByRole("button", { name: "Schedule render" }));

    await waitFor(() => {
        expect(apiMocks.createPlannerRun).toHaveBeenLastCalledWith(
        expect.objectContaining({
          blendFilePath: updatedPlannerRun.blendFilePath,
          startFrame: 1,
          endFrame: 180,
          outputFolderPath: "D:\\Renders\\Shot_010",
          shutdownWhenDone: false,
          blender: {
            source: "library",
            versionId: installedVersion.id,
            executablePath: null,
          },
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Open logs for render-scene.blend" }));

    await waitFor(() => {
      expect(apiMocks.getPlannerLogs).toHaveBeenCalledWith(plannerRun.id);
    });
    expect(await screen.findByText("Fra:1 Mem:30.00M")).toBeInTheDocument();

    emitPlannerLog({
      ...plannerLog,
      id: "planner-1-1",
      message: "Fra:2 Mem:31.00M",
      timestamp: 3,
    });

    expect(await screen.findByText("Fra:2 Mem:31.00M")).toBeInTheDocument();

    emitPlannerRuns([
      {
        ...updatedPlannerRun,
        status: "completed",
        startedAt: updatedPlannerRun.startAt,
        completedAt: updatedPlannerRun.startAt + 120,
        currentFrame: 180,
        renderedFrameCount: 180,
        averageRenderTimeSeconds: 3,
        estimatedRemainingSeconds: null,
        pid: null,
      },
    ]);

    fireEvent.click(await screen.findByRole("button", { name: "Delete render-scene.blend" }));

    await waitFor(() => {
      expect(apiMocks.deletePlannerRun).toHaveBeenCalledWith(plannerRun.id);
    });
  });

  it("refreshes the home page without overlapping interval requests and clears session UI when processes disappear", async () => {
    vi.useFakeTimers();

    const launcherStateDeferred = createDeferred<LauncherState>();
    const recentProjectsDeferred = createDeferred<RecentProject[]>();
    const runningLogsDeferred = createDeferred<BlenderLogEntry[]>();

    apiMocks.getLauncherState.mockImplementationOnce(() => launcherStateDeferred.promise).mockResolvedValue(launcherState);
    apiMocks.getRecentProjects.mockImplementationOnce(() => recentProjectsDeferred.promise).mockResolvedValue([recentProject]);
    apiMocks.getRunningBlenderLogs.mockImplementationOnce(() => runningLogsDeferred.promise);

    render(<App />);

    expect(apiMocks.getLauncherState).toHaveBeenCalledTimes(1);
    expect(apiMocks.getRecentProjects).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(apiMocks.getLauncherState).toHaveBeenCalledTimes(1);
    expect(apiMocks.getRecentProjects).toHaveBeenCalledTimes(1);

    launcherStateDeferred.resolve(launcherState);
    recentProjectsDeferred.resolve([recentProject]);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(apiMocks.getLauncherState).toHaveBeenCalledTimes(2);
    expect(apiMocks.getRecentProjects).toHaveBeenCalledTimes(2);

    vi.useRealTimers();

    await screen.findByText("Continue where you left off");

    emitRunningBlenders([runningBlender]);
    expect(await screen.findByText("1 running")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Blender tray/ }));
    fireEvent.click(screen.getByRole("button", { name: "View live logs" }));

    expect(await screen.findByRole("dialog", { name: "Blender 4.2.3" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

    emitRunningBlenders([]);
    expect(await screen.findByText("1 recent session")).toBeInTheDocument();

    runningLogsDeferred.resolve([runningBlenderLog]);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("shows log loading and stop errors, then lets the user dismiss the stop dialog", async () => {
    apiMocks.getRunningBlenderLogs.mockRejectedValueOnce(new Error("Log service offline"));
    apiMocks.stopRunningBlender.mockRejectedValueOnce(new Error("Stop failed"));

    render(<App />);

    await screen.findByText("Continue where you left off");

    emitRunningBlenders([runningBlender]);

    fireEvent.click(await screen.findByRole("button", { name: /Blender tray/ }));
    fireEvent.click(screen.getByRole("button", { name: "View live logs" }));

    expect(await screen.findByText("Log service offline")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "Stop Blender" }));

    const stopDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(stopDialog).getByRole("button", { name: "Stop Blender" }));

    expect(await screen.findByText("Stop failed")).toBeInTheDocument();

    fireEvent.click(within(stopDialog).getByRole("button", { name: "Keep it running" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("removes missing recent projects through a confirm dialog", async () => {
    apiMocks.getRecentProjects.mockResolvedValueOnce([{ ...recentProject, exists: false }]).mockResolvedValue([]);

    render(<App />);

    await screen.findByText("Continue where you left off");
    fireEvent.click(screen.getByRole("button", { name: "Remove Test Scene from recent projects" }));

    const removeDialog = await screen.findByRole("alertdialog");
    expect(within(removeDialog).getByText("Remove Test Scene from recent projects?")).toBeInTheDocument();

    fireEvent.click(within(removeDialog).getByRole("button", { name: "Remove recent project" }));

    await waitFor(() => {
      expect(apiMocks.removeRecentProject).toHaveBeenCalledWith(recentProject.filePath);
    });

    await waitFor(() => {
      expect(screen.queryByText("Test Scene")).not.toBeInTheDocument();
    });
  });

  it("surfaces config loading, saving, applying, and removing errors", async () => {
    apiMocks.getBlenderConfigs.mockRejectedValueOnce(new Error("Config list failed"));
    apiMocks.saveBlenderConfig.mockRejectedValueOnce(new Error("Save failed"));
    apiMocks.applyBlenderConfig.mockRejectedValueOnce(new Error("Apply failed"));
    apiMocks.removeBlenderConfig.mockRejectedValueOnce(new Error("Remove failed"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Releases" }));
    await screen.findByText("Stable builds for Windows x64");

    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply a config" }));

    expect(await screen.findByText("Config list failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save config" }));

    fireEvent.change(screen.getByLabelText("Config name"), { target: { value: "Broken Save" } });
    fireEvent.click(screen.getByRole("button", { name: "Save current config" }));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply a config" }));

    await screen.findByRole("dialog", { name: "Blender 4.2.3" });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Apply failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const removeDialog = await screen.findByRole("alertdialog");
    expect(within(removeDialog).getByText("Remove Studio?")).toBeInTheDocument();

    fireEvent.click(within(removeDialog).getByRole("button", { name: "Remove config" }));
    expect(await within(removeDialog).findByText("Remove failed")).toBeInTheDocument();

    fireEvent.click(within(removeDialog).getByRole("button", { name: "Keep it" }));
    await waitFor(() => {
      expect(screen.queryByText("Remove Studio?")).not.toBeInTheDocument();
    });
  });
});





















