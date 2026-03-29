import { Cog, Play, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isBlenderLtsVersion } from "../../lib/blenderVersions";
import type { BlenderReleaseDownload, BlenderReleaseInstallProgress, BlenderVersion } from "../../types";
import { Tooltip } from "../Tooltip";

interface ReleaseRowProps {
  download: BlenderReleaseDownload;
  favoriteReleaseValues: string[];
  installStatuses: Record<string, BlenderReleaseInstallProgress>;
  installedReleaseVersions: Map<string, BlenderVersion>;
  isCurrentPlatformList: boolean;
  isExperimentalList?: boolean;
  onInstall: (download: BlenderReleaseDownload) => void;
  onCancelInstall: (download: BlenderReleaseDownload) => void;
  onLaunchVersion: (version: BlenderVersion) => void;
  onOpenConfigs: (version: BlenderVersion, mode: "save" | "apply") => void;
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

function getChannelChipClassName(channel: string, isExperimentalList: boolean) {
  if (!isExperimentalList) {
    return "release-channel-chip";
  }

  const normalizedChannel = channel.toLowerCase();

  if (normalizedChannel.includes("alpha")) {
    return "release-channel-chip release-channel-chip-alpha";
  }

  if (normalizedChannel.includes("beta")) {
    return "release-channel-chip release-channel-chip-beta";
  }

  if (normalizedChannel.includes("candidate")) {
    return "release-channel-chip release-channel-chip-candidate";
  }

  return "release-channel-chip";
}

export function ReleaseRow({
  download,
  favoriteReleaseValues,
  installStatuses,
  installedReleaseVersions,
  isCurrentPlatformList,
  isExperimentalList = false,
  onInstall,
  onCancelInstall,
  onLaunchVersion,
  onOpenConfigs,
  onToggleFavorite,
  onOpenUninstall,
}: ReleaseRowProps) {
  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);
  const configMenuRef = useRef<HTMLDivElement | null>(null);
  const isFavorite = favoriteReleaseValues.includes(download.version) || favoriteReleaseValues.includes(download.id);
  const installedVersion = isCurrentPlatformList ? installedReleaseVersions.get(download.version) : undefined;
  const isInstalled = Boolean(installedVersion);
  const installStatus = isCurrentPlatformList ? installStatuses[download.id] : undefined;
  const showLtsBadge = !isExperimentalList && isBlenderLtsVersion(download.version);
  const isInstalling = installStatus ? activeInstallPhases.includes(installStatus.phase) : false;
  const showInstallStatus = Boolean(installStatus) && installStatus?.phase !== "completed";
  const showProgressBar = installStatus ? activeInstallPhases.includes(installStatus.phase) : false;
  const progressLabel = installStatus?.progressPercent != null ? `${Math.round(installStatus.progressPercent)}%` : null;
  const sizeLabel = installStatus?.totalBytes
    ? `${formatBytes(installStatus.downloadedBytes) ?? "0 B"} / ${formatBytes(installStatus.totalBytes) ?? "0 B"}`
    : formatBytes(installStatus?.downloadedBytes ?? null);
  const speedLabel = formatSpeed(installStatus?.speedBytesPerSecond ?? null);
  const installMeta = [progressLabel, sizeLabel, speedLabel].filter(Boolean).join(" | ");
  const installStatusClassName = installStatus
    ? `release-install-status release-install-status-${installStatus.phase}`
    : "release-install-status";

  useEffect(() => {
    if (!isConfigMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!configMenuRef.current?.contains(event.target as Node)) {
        setIsConfigMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsConfigMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isConfigMenuOpen]);

  function openConfigDialog(mode: "save" | "apply") {
    if (!installedVersion) {
      return;
    }

    setIsConfigMenuOpen(false);
    onOpenConfigs(installedVersion, mode);
  }

  const rowClassName = isConfigMenuOpen ? "release-row release-row-item release-row-item-config-open" : "release-row release-row-item";

  return (
    <article className={rowClassName}>
      <div className="release-version-cell release-primary">
        <div className="release-version-meta">
          <strong>{download.version}</strong>
          {showLtsBadge ? <span className="release-version-badge">LTS</span> : null}
        </div>
      </div>

      <div className="release-channel-cell">
        <span className={getChannelChipClassName(download.channel, isExperimentalList)}>{download.channel}</span>
      </div>

      <div className="release-date-cell release-package">{download.releaseDate}</div>

      <div className="release-actions">
        {isCurrentPlatformList && isInstalled ? (
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

            <Tooltip
              content={`Manage configs for Blender ${download.version}`}
              className={isConfigMenuOpen ? "tooltip-active-layer" : undefined}
            >
              <div className="release-config-menu-shell" ref={configMenuRef}>
                <button
                  className="release-config-button"
                  type="button"
                  onClick={() => setIsConfigMenuOpen((current) => !current)}
                  aria-label={`Manage configs for Blender ${download.version}`}
                  aria-haspopup="menu"
                  aria-expanded={isConfigMenuOpen}
                >
                  <Cog className="release-launch-icon" aria-hidden="true" strokeWidth={1.75} />
                </button>

                {isConfigMenuOpen ? (
                  <div className="release-config-menu" role="menu" aria-label={`Config actions for Blender ${download.version}`}>
                    <button className="release-config-menu-item" type="button" role="menuitem" onClick={() => openConfigDialog("save")}>
                      Save config
                    </button>
                    <button
                      className="release-config-menu-item"
                      type="button"
                      role="menuitem"
                      onClick={() => openConfigDialog("apply")}
                    >
                      Apply a config
                    </button>
                  </div>
                ) : null}
              </div>
            </Tooltip>

            <Tooltip content={isFavorite ? "Remove favorite" : "Mark as favorite"}>
              <button
                className={isFavorite ? "favorite-button favorite-button-active" : "favorite-button"}
                type="button"
                onClick={() => onToggleFavorite(download)}
                aria-pressed={isFavorite}
                aria-label={isFavorite ? `Remove ${download.version} from favorites` : `Mark ${download.version} as favorite`}
              >
                <Star className="favorite-star" aria-hidden="true" fill={isFavorite ? "currentColor" : "none"} strokeWidth={2} />
              </button>
            </Tooltip>
          </>
        ) : null}

        {!isCurrentPlatformList ? (
          <button className="card-action card-action-secondary" type="button" disabled>
            Current OS only
          </button>
        ) : isInstalling ? (
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
}



