import { Play, Star } from "lucide-react";
import { Tooltip } from "../components/Tooltip";
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
  favoriteReleaseIds: string[];
  installStatuses: Record<string, BlenderReleaseInstallProgress>;
  installedReleaseVersions: Map<string, BlenderVersion>;
  onRefresh: () => void;
  onInstall: (download: BlenderReleaseDownload) => void;
  onCancelInstall: (download: BlenderReleaseDownload) => void;
  onLaunchVersion: (version: BlenderVersion) => void;
  onToggleFavorite: (download: BlenderReleaseDownload) => void;
  onOpenUninstall: (download: BlenderReleaseDownload) => void;
}

const activeInstallPhases = ["starting", "downloading", "extracting", "canceling"];

function formatBytes(value: number | null) {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  const digits = amount >= 100 || unitIndex === 0 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

function formatSpeed(value: number | null) {
  const formatted = formatBytes(value);
  return formatted ? `${formatted}/s` : null;
}

export function ReleasesPage({
  releaseListing,
  releaseError,
  isLoadingReleases,
  favoriteReleaseIds,
  installStatuses,
  installedReleaseVersions,
  onRefresh,
  onInstall,
  onCancelInstall,
  onLaunchVersion,
  onToggleFavorite,
  onOpenUninstall,
}: ReleasesPageProps) {
  const releaseDownloads = releaseListing?.downloads ?? [];

  return (
    <section className="release-page">
      <section className="release-hero">
        <div className="release-hero-copy">
          <p className="section-kicker">Official Release Downloads</p>
          <h3>Stable builds for {releaseListing?.platformLabel ?? "this platform"}</h3>
        </div>

        <div className="release-hero-actions">
          <span className="section-badge">{favoriteReleaseIds.length} favorites</span>
          <button className="card-action card-action-secondary" type="button" onClick={onRefresh}>
            {isLoadingReleases ? "Refreshing..." : "Refresh list"}
          </button>
        </div>
      </section>

      {releaseError ? (
        <section className="release-state release-state-error">
          <h3>Could not load the Blender download list</h3>
          <p>{releaseError}</p>
        </section>
      ) : isLoadingReleases && releaseDownloads.length === 0 ? (
        <section className="release-state">
          <h3>Loading release downloads</h3>
          <p>Scanning the official Blender release folders for platform-matching build files.</p>
        </section>
      ) : (
        <section className="release-list" aria-label="Stable Blender downloads">
          <div className="release-list-header release-row">
            <span className="release-version-cell">Version</span>
            <span className="release-channel-cell">Channel</span>
            <span className="release-date-cell">Release date</span>
            <span className="release-actions-heading">Actions</span>
          </div>

          {releaseDownloads.map((download) => {
            const isFavorite = favoriteReleaseIds.includes(download.id);
            const installedVersion = installedReleaseVersions.get(download.version);
            const isInstalled = Boolean(installedVersion);
            const installStatus = installStatuses[download.id];
            const isInstalling = installStatus ? activeInstallPhases.includes(installStatus.phase) : false;
            const showInstallStatus = Boolean(installStatus) && installStatus?.phase !== "completed";
            const showProgressBar = Boolean(installStatus) && activeInstallPhases.includes(installStatus.phase);
            const progressLabel =
              installStatus?.progressPercent != null ? `${Math.round(installStatus.progressPercent)}%` : null;
            const sizeLabel = installStatus?.totalBytes
              ? `${formatBytes(installStatus.downloadedBytes) ?? "0 B"} / ${formatBytes(installStatus.totalBytes) ?? "0 B"}`
              : formatBytes(installStatus?.downloadedBytes ?? null);
            const speedLabel = formatSpeed(installStatus?.speedBytesPerSecond ?? null);
            const installMeta = [progressLabel, sizeLabel, speedLabel].filter(Boolean).join(" | ");
            const installStatusClassName = installStatus
              ? `release-install-status release-install-status-${installStatus.phase}`
              : "release-install-status";

            return (
              <article className="release-row release-row-item" key={download.id}>
                <div className="release-version-cell release-primary">
                  <strong>{download.version}</strong>
                </div>

                <div className="release-channel-cell">
                  <span className="release-channel-chip">{download.channel}</span>
                </div>

                <div className="release-date-cell release-package">{download.releaseDate}</div>

                <div className="release-actions">
                  {isInstalled ? (
                    <>
                      <Tooltip content={`Launch Blender ${download.version}`}>
                        <button
                          className="release-launch-button"
                          type="button"
                          onClick={() => onLaunchVersion(installedVersion!)}
                          aria-label={`Launch Blender ${download.version}`}
                        >
                          <Play className="release-launch-icon" aria-hidden="true" fill="currentColor" strokeWidth={1.75} />
                        </button>
                      </Tooltip>

                      <Tooltip content={isFavorite ? "Remove favorite" : "Mark as favorite"}>
                        <button
                          className={isFavorite ? "favorite-button favorite-button-active" : "favorite-button"}
                          type="button"
                          onClick={() => onToggleFavorite(download)}
                          aria-pressed={isFavorite}
                          aria-label={isFavorite ? `Remove ${download.version} from favorites` : `Mark ${download.version} as favorite`}
                        >
                          <Star
                            className="favorite-star"
                            aria-hidden="true"
                            fill={isFavorite ? "currentColor" : "none"}
                            strokeWidth={2}
                          />
                        </button>
                      </Tooltip>
                    </>
                  ) : null}

                  {isInstalling ? (
                    <button
                      className="card-action card-action-secondary"
                      type="button"
                      disabled={installStatus?.phase === "canceling"}
                      onClick={() => onCancelInstall(download)}
                    >
                      {installStatus?.phase === "canceling" ? "Canceling..." : "Cancel"}
                    </button>
                  ) : (
                    <button
                      className={isInstalled ? "card-action card-action-secondary card-action-installed" : "card-action card-action-link"}
                      type="button"
                      onClick={isInstalled ? () => onOpenUninstall(download) : () => onInstall(download)}
                    >
                      {isInstalled ? (
                        <>
                          <span className="card-action-installed-default">Installed</span>
                          <span className="card-action-installed-hover">Uninstall</span>
                        </>
                      ) : (
                        "Install"
                      )}
                    </button>
                  )}
                </div>

                {showInstallStatus && installStatus ? (
                  <div className={installStatusClassName}>
                    <div className="release-install-copy">
                      <strong className="release-install-title">{installStatus.message}</strong>
                      {installMeta ? <span className="release-install-meta">{installMeta}</span> : null}
                    </div>

                    {showProgressBar ? (
                      <div
                        className={
                          installStatus.progressPercent == null
                            ? "release-progress-track release-progress-track-indeterminate"
                            : "release-progress-track"
                        }
                        aria-hidden="true"
                      >
                        <span
                          className="release-progress-fill"
                          style={
                            installStatus.progressPercent == null
                              ? undefined
                              : { width: `${Math.max(4, Math.min(100, installStatus.progressPercent))}%` }
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </section>
  );
}

