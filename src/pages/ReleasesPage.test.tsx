import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReleasesPage } from "./ReleasesPage";
import type { BlenderReleaseListing, BlenderVersion } from "../types";

const stableDownload = {
  id: "release-stable",
  channel: "Blender4.2",
  version: "4.2.3",
  fileName: "blender-4.2.3-windows-x64.zip",
  releaseDate: "2026-03-20",
  url: "https://download.blender.org/release/Blender4.2/blender-4.2.3-windows-x64.zip",
};

const experimentalDownload = {
  id: "release-experimental",
  channel: "Alpha",
  version: "4.3.0",
  fileName: "blender-4.3.0-alpha-windows-x64.zip",
  releaseDate: "2026-03-21",
  url: "https://builder.blender.org/download/daily/blender-4.3.0-alpha-windows-x64.zip",
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

const releaseListing: BlenderReleaseListing = {
  platformLabel: "Windows x64",
  stableDownloads: [stableDownload],
  experimentalGroups: [
    {
      platformKey: "windows",
      platformLabel: "Windows x64",
      downloads: [experimentalDownload],
    },
  ],
  experimentalError: null,
};

describe("ReleasesPage", () => {
  it("renders stable releases and refresh actions", () => {
    const onRefresh = vi.fn();

    render(
      <ReleasesPage
        releaseListing={releaseListing}
        releaseError={null}
        isLoadingReleases={false}
        favoriteVersionCount={2}
        favoriteReleaseValues={[stableDownload.version]}
        installStatuses={{}}
        installedReleaseVersions={new Map([[stableDownload.version, installedVersion]])}
        onRefresh={onRefresh}
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Stable builds for Windows x64")).toBeInTheDocument();
    expect(screen.getByLabelText("Stable Blender downloads")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("switches to the experimental view and renders current-platform downloads", () => {
    render(
      <ReleasesPage
        releaseListing={releaseListing}
        releaseError={null}
        isLoadingReleases={false}
        favoriteVersionCount={0}
        favoriteReleaseValues={[]}
        installStatuses={{}}
        installedReleaseVersions={new Map()}
        onRefresh={vi.fn()}
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Experimental" }));

    expect(screen.getByText("Experimental daily builds")).toBeInTheDocument();
    expect(screen.getByLabelText("Windows x64 experimental Blender downloads")).toBeInTheDocument();
    expect(screen.getByText("4.3.0")).toBeInTheDocument();
  });

  it("shows loading and error states when release data is unavailable", () => {
    const { rerender } = render(
      <ReleasesPage
        releaseListing={null}
        releaseError={null}
        isLoadingReleases
        favoriteVersionCount={0}
        favoriteReleaseValues={[]}
        installStatuses={{}}
        installedReleaseVersions={new Map()}
        onRefresh={vi.fn()}
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading release downloads")).toBeInTheDocument();

    rerender(
      <ReleasesPage
        releaseListing={null}
        releaseError="Could not reach blender.org"
        isLoadingReleases={false}
        favoriteVersionCount={0}
        favoriteReleaseValues={[]}
        installStatuses={{}}
        installedReleaseVersions={new Map()}
        onRefresh={vi.fn()}
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText("Could not reach blender.org")).toBeInTheDocument();
  });

  it("shows experimental errors and empty stable states", () => {
    const { rerender } = render(
      <ReleasesPage
        releaseListing={{ ...releaseListing, experimentalGroups: [], experimentalError: "Daily builds unavailable" }}
        releaseError={null}
        isLoadingReleases={false}
        favoriteVersionCount={0}
        favoriteReleaseValues={[]}
        installStatuses={{}}
        installedReleaseVersions={new Map()}
        onRefresh={vi.fn()}
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Experimental" }));
    expect(screen.getByText("Could not load experimental builds")).toBeInTheDocument();
    expect(screen.getByText("Daily builds unavailable")).toBeInTheDocument();

    rerender(
      <ReleasesPage
        releaseListing={{ ...releaseListing, stableDownloads: [] }}
        releaseError={null}
        isLoadingReleases={false}
        favoriteVersionCount={0}
        favoriteReleaseValues={[]}
        installStatuses={{}}
        installedReleaseVersions={new Map()}
        onRefresh={vi.fn()}
        onInstall={vi.fn()}
        onCancelInstall={vi.fn()}
        onLaunchVersion={vi.fn()}
        onToggleFavorite={vi.fn()}
        onOpenUninstall={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Stable" }));
    expect(screen.getByText("No stable builds found")).toBeInTheDocument();
  });
});
