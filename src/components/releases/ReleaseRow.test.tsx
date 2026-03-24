import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReleaseRow } from "./ReleaseRow";
import type { BlenderReleaseDownload, BlenderReleaseInstallProgress, BlenderVersion } from "../../types";

const download: BlenderReleaseDownload = {
  id: "release-42",
  channel: "Blender4.2",
  version: "4.2.3",
  fileName: "blender-4.2.3-windows-x64.zip",
  releaseDate: "2026-03-20",
  url: "https://download.blender.org/release/Blender4.2/blender-4.2.3-windows-x64.zip",
};

const installedVersion: BlenderVersion = {
  id: "version-42",
  displayName: "Blender 4.2.3",
  version: "4.2.3",
  executablePath: "D:\\Blender\\blender.exe",
  installDir: "D:\\VoxelShift\\stable\\Blender 4.2.3",
  source: "manual",
  available: true,
  isDefault: false,
  lastLaunchedAt: null,
};

function makeInstallStatus(overrides: Partial<BlenderReleaseInstallProgress> = {}): BlenderReleaseInstallProgress {
  return {
    releaseId: download.id,
    phase: "downloading",
    progressPercent: 25,
    downloadedBytes: 256,
    totalBytes: 1024,
    speedBytesPerSecond: 512,
    installDir: null,
    message: "Downloading Blender 4.2.3",
    ...overrides,
  };
}

describe("ReleaseRow", () => {
  it("renders installed releases with launch, config menu, favorite, and uninstall actions", () => {
    const onLaunchVersion = vi.fn();
    const onOpenConfigs = vi.fn();
    const onToggleFavorite = vi.fn();
    const onOpenUninstall = vi.fn();

    render(
      <ReleaseRow
        download={download}
        favoriteReleaseValues={[download.version]}
        installStatuses={{}}
        installedReleaseVersions={new Map([[download.version, installedVersion]])}
        isCurrentPlatformList
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={onLaunchVersion}
        onOpenConfigs={onOpenConfigs}
        onToggleFavorite={onToggleFavorite}
        onOpenUninstall={onOpenUninstall}
      />,
    );

    expect(screen.getByText("LTS")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Launch Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save config" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply a config" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove 4.2.3 from favorites" }));
    fireEvent.click(screen.getByText("Installed").closest("button") as HTMLElement);

    expect(onLaunchVersion).toHaveBeenCalledWith(installedVersion);
    expect(onOpenConfigs).toHaveBeenNthCalledWith(1, installedVersion, "save");
    expect(onOpenConfigs).toHaveBeenNthCalledWith(2, installedVersion, "apply");
    expect(onToggleFavorite).toHaveBeenCalledWith(download);
    expect(onOpenUninstall).toHaveBeenCalledWith(download);
  });

  it("closes the config menu on escape and outside clicks", () => {
    render(
      <ReleaseRow
        download={download}
        favoriteReleaseValues={[]}
        installStatuses={{}}
        installedReleaseVersions={new Map([[download.version, installedVersion]])}
        isCurrentPlatformList
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onOpenConfigs={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    expect(screen.getByRole("menuitem", { name: "Save config" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Save config" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manage configs for Blender 4.2.3" }));
    expect(screen.getByRole("menuitem", { name: "Apply a config" })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menuitem", { name: "Apply a config" })).not.toBeInTheDocument();
  });

  it("shows install progress and cancel actions for active installs", () => {
    const onCancelInstall = vi.fn();

    render(
      <ReleaseRow
        download={download}
        favoriteReleaseValues={[]}
        installStatuses={{ [download.id]: makeInstallStatus() }}
        installedReleaseVersions={new Map()}
        isCurrentPlatformList
        onInstall={vi.fn()}
        onCancelInstall={onCancelInstall}
        onLaunchVersion={vi.fn()}
        onOpenConfigs={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Downloading Blender 4.2.3")).toBeInTheDocument();
    expect(screen.getByText("25% | 256 B / 1.00 KB | 512 B/s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelInstall).toHaveBeenCalledWith(download);
  });

  it("shows candidate, beta, and default experimental chip styles", () => {
    const { rerender } = render(
      <ReleaseRow
        download={{ ...download, channel: "Release Candidate" }}
        favoriteReleaseValues={[]}
        installStatuses={{ [download.id]: makeInstallStatus({ phase: "canceling", progressPercent: null, totalBytes: null }) }}
        installedReleaseVersions={new Map()}
        isCurrentPlatformList={false}
        isExperimentalList
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onOpenConfigs={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Release Candidate")).toHaveClass("release-channel-chip-candidate");
    expect(screen.getByRole("button", { name: "Current OS only" })).toBeDisabled();
    expect(screen.queryByText("LTS")).not.toBeInTheDocument();

    rerender(
      <ReleaseRow
        download={{ ...download, channel: "Beta" }}
        favoriteReleaseValues={[]}
        installStatuses={{ [download.id]: makeInstallStatus({ phase: "canceling", progressPercent: null, totalBytes: null }) }}
        installedReleaseVersions={new Map()}
        isCurrentPlatformList={false}
        isExperimentalList
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onOpenConfigs={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Beta")).toHaveClass("release-channel-chip-beta");

    rerender(
      <ReleaseRow
        download={{ ...download, channel: "Nightly" }}
        favoriteReleaseValues={[]}
        installStatuses={{ [download.id]: makeInstallStatus({ phase: "canceling", progressPercent: null, totalBytes: null }) }}
        installedReleaseVersions={new Map()}
        isCurrentPlatformList={false}
        isExperimentalList
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onOpenConfigs={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Nightly")).toHaveClass("release-channel-chip");
  });
});
