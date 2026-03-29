import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { BlenderReleaseDownload, BlenderReleaseListing, BlenderVersion, LauncherState, RecentProject } from "./types";

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
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
});
