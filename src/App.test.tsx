import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { BlenderReleaseDownload, BlenderReleaseInstallProgress, BlenderReleaseListing, BlenderVersion, LauncherState, RecentProject } from "./types";

const tauriMocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  listen: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  cancelBlenderReleaseInstall: vi.fn(),
  getBlenderReleaseDownloads: vi.fn(),
  getLauncherState: vi.fn(),
  getRecentProjects: vi.fn(),
  installBlenderRelease: vi.fn(),
  launchBlender: vi.fn(),
  launchBlenderProject: vi.fn(),
  removeBlenderVersion: vi.fn(),
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

function emitInstallProgress(progress: BlenderReleaseInstallProgress) {
  const listener = tauriMocks.listen.mock.calls[0]?.[1] as ((event: { payload: BlenderReleaseInstallProgress }) => void) | undefined;
  listener?.({ payload: progress });
}

describe("App", () => {
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
    apiMocks.getRecentProjects.mockResolvedValue([recentProject]);
    apiMocks.getBlenderReleaseDownloads.mockResolvedValue(releaseListing);
    apiMocks.installBlenderRelease.mockResolvedValue(launcherState);
    apiMocks.cancelBlenderReleaseInstall.mockResolvedValue(undefined);
    apiMocks.launchBlender.mockResolvedValue(launcherState);
    apiMocks.launchBlenderProject.mockResolvedValue(launcherState);
    apiMocks.removeBlenderVersion.mockResolvedValue({ ...launcherState, versions: [] });
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
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Update to v1.1.0" })[0]);

    await screen.findByText("Voxel Shift 1.1.0 installed");
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
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
      installDir: "D:\\VoxelShift\\stable\\Blender 4.3.0",
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
});

