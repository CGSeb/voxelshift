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
  it("renders installed releases with launch, favorite, and uninstall actions", () => {
    const onLaunchVersion = vi.fn();
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
        onToggleFavorite={onToggleFavorite}
        onOpenUninstall={onOpenUninstall}
      />,
    );

    expect(screen.getByText("LTS")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Launch Blender 4.2.3" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove 4.2.3 from favorites" }));
    fireEvent.click(screen.getByText("Installed").closest("button") as HTMLElement);

    expect(onLaunchVersion).toHaveBeenCalledWith(installedVersion);
    expect(onToggleFavorite).toHaveBeenCalledWith(download);
    expect(onOpenUninstall).toHaveBeenCalledWith(download);
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
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Downloading Blender 4.2.3")).toBeInTheDocument();
    expect(screen.getByText("25% | 256 B / 1.00 KB | 512 B/s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelInstall).toHaveBeenCalledWith(download);
  });

  it("shows current-os restrictions and experimental chip styles for other platforms", () => {
    render(
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
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Beta")).toHaveClass("release-channel-chip-beta");
    expect(screen.getByRole("button", { name: "Current OS only" })).toBeDisabled();
    expect(screen.queryByText("LTS")).not.toBeInTheDocument();
  });
});

