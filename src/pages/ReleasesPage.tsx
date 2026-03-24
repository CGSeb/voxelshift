import { useState } from "react";
import { ReleaseRow } from "../components/releases/ReleaseRow";
import type {
  BlenderReleaseDownload,
  BlenderReleaseInstallProgress,
  BlenderReleaseListing,
  BlenderVersion,
} from "../types";

interface ReleasesPageProps {
  releaseListing: BlenderReleaseListing | null;
  releaseError: string | null;
  isLoadingReleases: boolean;
  favoriteVersionCount: number;
  favoriteReleaseValues: string[];
  installStatuses: Record<string, BlenderReleaseInstallProgress>;
  installedReleaseVersions: Map<string, BlenderVersion>;
  onRefresh: () => void;
  onInstall: (download: BlenderReleaseDownload) => void;
  onCancelInstall: (download: BlenderReleaseDownload) => void;
  onLaunchVersion: (version: BlenderVersion) => void;
  onOpenConfigs: (version: BlenderVersion, mode: "save" | "apply") => void;
  onToggleFavorite: (download: BlenderReleaseDownload) => void;
  onOpenUninstall: (download: BlenderReleaseDownload) => void;
}

type ReleaseScope = "stable" | "experimental";

interface ReleaseListProps {
  ariaLabel: string;
  downloads: BlenderReleaseDownload[];
  emptyTitle: string;
  emptyMessage: string;
  isExperimentalList?: boolean;
  favoriteReleaseValues: string[];
  installStatuses: Record<string, BlenderReleaseInstallProgress>;
  installedReleaseVersions: Map<string, BlenderVersion>;
  isCurrentPlatformList: boolean;
  onInstall: (download: BlenderReleaseDownload) => void;
  onCancelInstall: (download: BlenderReleaseDownload) => void;
  onLaunchVersion: (version: BlenderVersion) => void;
  onOpenConfigs: (version: BlenderVersion, mode: "save" | "apply") => void;
  onToggleFavorite: (download: BlenderReleaseDownload) => void;
  onOpenUninstall: (download: BlenderReleaseDownload) => void;
}

function ReleaseList({
  ariaLabel,
  downloads,
  emptyTitle,
  emptyMessage,
  isExperimentalList = false,
  favoriteReleaseValues,
  installStatuses,
  installedReleaseVersions,
  isCurrentPlatformList,
  onInstall,
  onCancelInstall,
  onLaunchVersion,
  onOpenConfigs,
  onToggleFavorite,
  onOpenUninstall,
}: ReleaseListProps) {
  if (downloads.length === 0) {
    return (
      <section className="release-state">
        <h3>{emptyTitle}</h3>
        <p>{emptyMessage}</p>
      </section>
    );
  }

  return (
    <section className="release-list" aria-label={ariaLabel}>
      <div className="release-list-header release-row">
        <span className="release-version-cell">Version</span>
        <span className="release-channel-cell">Stage</span>
        <span className="release-date-cell">Release date</span>
        <span className="release-actions-heading">{isCurrentPlatformList ? "Actions" : "Availability"}</span>
      </div>

      {downloads.map((download) => {
        return (
          <ReleaseRow
            key={download.id}
            download={download}
            favoriteReleaseValues={favoriteReleaseValues}
            installStatuses={installStatuses}
            installedReleaseVersions={installedReleaseVersions}
            isCurrentPlatformList={isCurrentPlatformList}
            isExperimentalList={isExperimentalList}
            onInstall={onInstall}
            onCancelInstall={onCancelInstall}
            onLaunchVersion={onLaunchVersion}
            onOpenConfigs={onOpenConfigs}
            onToggleFavorite={onToggleFavorite}
            onOpenUninstall={onOpenUninstall}
          />
        );
      })}
    </section>
  );
}

export function ReleasesPage({
  releaseListing,
  releaseError,
  isLoadingReleases,
  favoriteVersionCount,
  favoriteReleaseValues,
  installStatuses,
  installedReleaseVersions,
  onRefresh,
  onInstall,
  onCancelInstall,
  onLaunchVersion,
  onOpenConfigs,
  onToggleFavorite,
  onOpenUninstall,
}: ReleasesPageProps) {
  const [activeScope, setActiveScope] = useState<ReleaseScope>("stable");

  const stableDownloads = releaseListing?.stableDownloads ?? [];
  const activeExperimentalGroup =
    releaseListing?.experimentalGroups.find((group) => group.platformLabel === releaseListing.platformLabel) ?? null;

  const heroTitle =
    activeScope === "stable"
      ? `Stable builds for ${releaseListing?.platformLabel ?? "this platform"}`
      : "Experimental daily builds";
  const heroCopy =
    activeScope === "stable"
      ? "Install the official Blender releases that match this machine."
      : "Daily x64 builds from builder.blender.org.";

  return (
    <section className="release-page">
      <section className="release-hero">
        <div className="release-hero-copy">
          <p className="section-kicker">Official Release Downloads</p>
          <h3>{heroTitle}</h3>
          <p className="release-copy">{heroCopy}</p>
        </div>

        <div className="release-hero-actions">
          <span className="section-badge">{favoriteVersionCount} favorites</span>
          <button className="card-action card-action-secondary" type="button" onClick={onRefresh}>
            {isLoadingReleases ? "Refreshing..." : "Refresh list"}
          </button>
        </div>
      </section>

      <section className="release-switcher-panel">
        <div className="release-tab-bar" role="tablist" aria-label="Release library tabs">
          <button
            className={activeScope === "stable" ? "release-tab release-tab-active" : "release-tab"}
            type="button"
            role="tab"
            aria-selected={activeScope === "stable"}
            onClick={() => setActiveScope("stable")}
          >
            Stable
          </button>
          <button
            className={activeScope === "experimental" ? "release-tab release-tab-active" : "release-tab"}
            type="button"
            role="tab"
            aria-selected={activeScope === "experimental"}
            onClick={() => setActiveScope("experimental")}
          >
            Experimental
          </button>
        </div>
      </section>

      {releaseError ? (
        <section className="release-state release-state-error">
          <h3>Could not load the Blender download list</h3>
          <p>{releaseError}</p>
        </section>
      ) : isLoadingReleases && stableDownloads.length === 0 && !activeExperimentalGroup ? (
        <section className="release-state">
          <h3>Loading release downloads</h3>
          <p>Collecting official Blender releases and the latest experimental daily builds.</p>
        </section>
      ) : activeScope === "stable" ? (
        <ReleaseList
          ariaLabel="Stable Blender downloads"
          downloads={stableDownloads}
          emptyTitle="No stable builds found"
          emptyMessage="Scanning the official Blender release folders did not return any matching downloads."
          favoriteReleaseValues={favoriteReleaseValues}
          installStatuses={installStatuses}
          installedReleaseVersions={installedReleaseVersions}
          isCurrentPlatformList
          onInstall={onInstall}
          onCancelInstall={onCancelInstall}
          onLaunchVersion={onLaunchVersion}
          onOpenConfigs={onOpenConfigs}
          onToggleFavorite={onToggleFavorite}
          onOpenUninstall={onOpenUninstall}
        />
      ) : activeExperimentalGroup ? (
        <ReleaseList
          ariaLabel={`${releaseListing?.platformLabel ?? "Current OS"} experimental Blender downloads`}
          downloads={activeExperimentalGroup.downloads}
          emptyTitle={`No experimental ${releaseListing?.platformLabel ?? "current OS"} builds found`}
          emptyMessage="The daily builds page did not expose any installable x64 entries for this operating system."
          isExperimentalList
          favoriteReleaseValues={favoriteReleaseValues}
          installStatuses={installStatuses}
          installedReleaseVersions={installedReleaseVersions}
          isCurrentPlatformList
          onInstall={onInstall}
          onCancelInstall={onCancelInstall}
          onLaunchVersion={onLaunchVersion}
          onOpenConfigs={onOpenConfigs}
          onToggleFavorite={onToggleFavorite}
          onOpenUninstall={onOpenUninstall}
        />
      ) : (
        <section className={releaseListing?.experimentalError ? "release-state release-state-error" : "release-state"}>
          <h3>{releaseListing?.experimentalError ? "Could not load experimental builds" : "No experimental builds found"}</h3>
          <p>{releaseListing?.experimentalError ?? "The daily builds page did not return any x64 experimental downloads."}</p>
        </section>
      )}
    </section>
  );
}
