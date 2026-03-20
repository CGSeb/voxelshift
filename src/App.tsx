import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Play, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Tooltip } from "./components/Tooltip";
import {
  cancelBlenderReleaseInstall,
  getBlenderReleaseDownloads,
  getLauncherState,
  installBlenderRelease,
  launchBlender,
  removeBlenderVersion,
} from "./lib/api";
import type {
  BlenderReleaseDownload,
  BlenderReleaseInstallProgress,
  BlenderReleaseListing,
  BlenderVersion,
  LauncherState,
  ReleaseInstallPhase,
} from "./types";

const favoriteReleaseStorageKey = "voxelshift.favorite-release-downloads";
const releaseInstallEvent = "release-install-progress";
const activeInstallPhases: ReleaseInstallPhase[] = ["starting", "downloading", "extracting", "canceling"];
const installCanceledMessage = "Installation canceled.";

const recentProjects = [
  {
    id: "dust-lab",
    name: "Dust Lab",
    version: "Blender 4.2 LTS",
    updated: "Edited 2 hours ago",
    accent: "sand",
  },
  {
    id: "courtyard-study",
    name: "Courtyard Study",
    version: "Blender 3.6 LTS",
    updated: "Edited yesterday",
    accent: "teal",
  },
  {
    id: "relay-bike",
    name: "Relay Bike",
    version: "Blender 4.1",
    updated: "Edited 4 days ago",
    accent: "ember",
  },
];

const favoriteVersions = [
  {
    id: "blender-4-2",
    name: "Blender 4.2 LTS",
    channel: "Stable favorite",
    path: "Documents/VoxelShift/stable/blender-4.2",
  },
  {
    id: "blender-4-1",
    name: "Blender 4.1",
    channel: "Portable build",
    path: "Documents/VoxelShift/stable/blender-4.1",
  },
  {
    id: "blender-3-6",
    name: "Blender 3.6 LTS",
    channel: "Legacy project support",
    path: "Documents/VoxelShift/stable/blender-3.6",
  },
];

type PageKey = "home" | "releases";

function persistFavoriteReleaseIds(ids: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify(ids));
}

function readFavoriteReleaseIds() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(favoriteReleaseStorageKey);
    if (!raw) {
      return [] as string[];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [] as string[];
  }
}

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

function readErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function makeFallbackInstallStatus(download: BlenderReleaseDownload, message: string, phase: ReleaseInstallPhase): BlenderReleaseInstallProgress {
  return {
    releaseId: download.id,
    phase,
    progressPercent: null,
    downloadedBytes: 0,
    totalBytes: null,
    speedBytesPerSecond: null,
    installDir: null,
    message,
  };
}

function isManagedInstall(version: BlenderVersion) {
  const normalizedInstallDir = version.installDir.replaceAll("\\", "/").toLowerCase();
  return normalizedInstallDir.includes("/voxelshift/stable/");
}

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [releaseListing, setReleaseListing] = useState<BlenderReleaseListing | null>(null);
  const [launcherState, setLauncherState] = useState<LauncherState | null>(null);
  const [installStatuses, setInstallStatuses] = useState<Record<string, BlenderReleaseInstallProgress>>({});
  const [isLoadingReleases, setIsLoadingReleases] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [favoriteReleaseIds, setFavoriteReleaseIds] = useState<string[]>(() => readFavoriteReleaseIds());
  const [pendingUninstallDownload, setPendingUninstallDownload] = useState<BlenderReleaseDownload | null>(null);
  const [isRemovingVersion, setIsRemovingVersion] = useState(false);
  const [removeVersionError, setRemoveVersionError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let isDisposed = false;

    async function subscribeToInstallProgress() {
      unlisten = await listen<BlenderReleaseInstallProgress>(releaseInstallEvent, (event) => {
        if (isDisposed) {
          return;
        }

        setInstallStatuses((current) => {
          if (event.payload.phase === "completed" || event.payload.phase === "canceled") {
            const next = { ...current };
            delete next[event.payload.releaseId];
            return next;
          }

          return {
            ...current,
            [event.payload.releaseId]: event.payload,
          };
        });
      });
    }

    void subscribeToInstallProgress();

    return () => {
      isDisposed = true;
      if (unlisten) {
        void unlisten();
      }
    };
  }, []);

  async function refreshReleasePageData() {
    setIsLoadingReleases(true);
    setReleaseError(null);

    const [releaseResult, launcherResult] = await Promise.allSettled([
      getBlenderReleaseDownloads(),
      getLauncherState(),
    ]);

    if (releaseResult.status === "fulfilled") {
      setReleaseListing(releaseResult.value);
    } else {
      const message =
        releaseResult.reason instanceof Error
          ? releaseResult.reason.message
          : "Could not load Blender release downloads.";
      setReleaseError(message);
    }

    if (launcherResult.status === "fulfilled") {
      setLauncherState(launcherResult.value);
    } else {
      setLauncherState(null);
    }

    setIsLoadingReleases(false);
  }

  useEffect(() => {
    if (activePage !== "releases" || releaseListing) {
      return;
    }

    void refreshReleasePageData();
  }, [activePage, releaseListing]);

  function toggleFavorite(download: BlenderReleaseDownload) {
    setFavoriteReleaseIds((current) => {
      const next = current.includes(download.id)
        ? current.filter((id) => id !== download.id)
        : [...current, download.id];

      persistFavoriteReleaseIds(next);
      return next;
    });
  }

  function removeFavorite(downloadId: string) {
    setFavoriteReleaseIds((current) => {
      if (!current.includes(downloadId)) {
        return current;
      }

      const next = current.filter((id) => id !== downloadId);
      persistFavoriteReleaseIds(next);
      return next;
    });
  }

  async function installRelease(download: BlenderReleaseDownload) {
    setInstallStatuses((current) => ({
      ...current,
      [download.id]: {
        releaseId: download.id,
        phase: "starting",
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: null,
        speedBytesPerSecond: null,
        installDir: null,
        message: `Preparing Blender ${download.version} for install`,
      },
    }));

    try {
      const nextLauncherState = await installBlenderRelease({
        id: download.id,
        version: download.version,
        fileName: download.fileName,
        url: download.url,
      });

      setLauncherState(nextLauncherState);
    } catch (error) {
      const message = readErrorMessage(error, `Could not install Blender ${download.version}.`);

      setInstallStatuses((current) => {
        if (message === installCanceledMessage) {
          const next = { ...current };
          delete next[download.id];
          return next;
        }

        const existing = current[download.id];
        if (existing?.phase === "failed" || existing?.phase === "canceled") {
          return current;
        }

        return {
          ...current,
          [download.id]: existing
            ? { ...existing, phase: "failed", progressPercent: null, message }
            : makeFallbackInstallStatus(download, message, "failed"),
        };
      });
    }
  }

  async function cancelInstall(download: BlenderReleaseDownload) {
    setInstallStatuses((current) => {
      const existing = current[download.id];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [download.id]: {
          ...existing,
          phase: "canceling",
          progressPercent: existing.progressPercent,
          message: "Canceling installation...",
        },
      };
    });

    try {
      await cancelBlenderReleaseInstall(download.id);
    } catch (error) {
      const message = readErrorMessage(error, `Could not cancel Blender ${download.version}.`);

      setInstallStatuses((current) => {
        const existing = current[download.id];
        return {
          ...current,
          [download.id]: existing
            ? { ...existing, phase: "failed", progressPercent: null, message }
            : makeFallbackInstallStatus(download, message, "failed"),
        };
      });
    }
  }

  async function launchInstalledRelease(version: BlenderVersion) {
    try {
      const nextLauncherState = await launchBlender({ id: version.id });
      setLauncherState(nextLauncherState);
      setReleaseError(null);
    } catch (error) {
      setReleaseError(readErrorMessage(error, `Could not launch Blender ${version.version ?? version.displayName}.`));
    }
  }

  const releaseDownloads = releaseListing?.downloads ?? [];
  const installedReleaseVersions = new Map<string, BlenderVersion>();

  for (const version of launcherState?.versions ?? []) {
    if (!version.available || !version.version || !isManagedInstall(version) || installedReleaseVersions.has(version.version)) {
      continue;
    }

    installedReleaseVersions.set(version.version, version);
  }


  function openUninstallDialog(download: BlenderReleaseDownload) {
    setPendingUninstallDownload(download);
    setRemoveVersionError(null);
  }

  function closeUninstallDialog() {
    if (isRemovingVersion) {
      return;
    }

    setPendingUninstallDownload(null);
    setRemoveVersionError(null);
  }

  async function confirmUninstall() {
    if (!pendingUninstallDownload) {
      return;
    }

    const installedVersion = installedReleaseVersions.get(pendingUninstallDownload.version);
    if (!installedVersion) {
      setRemoveVersionError(`Blender ${pendingUninstallDownload.version} is no longer installed here.`);
      return;
    }

    setIsRemovingVersion(true);
    setRemoveVersionError(null);

    try {
      const nextLauncherState = await removeBlenderVersion(installedVersion.id);
      setLauncherState(nextLauncherState);
      removeFavorite(pendingUninstallDownload.id);
      setPendingUninstallDownload(null);
    } catch (error) {
      setRemoveVersionError(readErrorMessage(error, `Could not remove Blender ${pendingUninstallDownload.version}.`));
    } finally {
      setIsRemovingVersion(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="home-frame">
        <header className="app-topbar">
          <div>
            <p className="section-kicker">Voxel Shift</p>
          </div>

          <nav className="page-switcher" aria-label="Primary navigation">
            <button
              className={activePage === "home" ? "page-tab page-tab-active" : "page-tab"}
              type="button"
              onClick={() => setActivePage("home")}
            >
              Home
            </button>
            <button
              className={activePage === "releases" ? "page-tab page-tab-active" : "page-tab"}
              type="button"
              onClick={() => setActivePage("releases")}
            >
              Releases
            </button>
          </nav>
        </header>

        {activePage === "home" ? (
          <>
            <section className="shelf-panel shelf-panel-first">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Recent Projects</p>
                  <h2>Continue creating</h2>
                </div>
                <span className="section-badge">Home mockup</span>
              </div>

              <div className="carousel-track" aria-label="Recent projects">
                {recentProjects.map((project) => (
                  <article className="project-card" key={project.id}>
                    <div className={`project-thumb project-thumb-${project.accent}`}>
                      <div className="thumb-shade" />
                      <div className="project-meta">
                        <span className="thumb-label">{project.version}</span>
                        <div className="project-copy">
                          <h3>{project.name}</h3>
                          <p>{project.updated}</p>
                        </div>
                        <button className="card-action" type="button">
                          Open Project
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="shelf-panel">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Favorite Versions</p>
                  <h2>Launch favorites</h2>
                </div>
              </div>

              <div className="carousel-track carousel-track-compact" aria-label="Favorite Blender versions">
                {favoriteVersions.map((version) => (
                  <article className="favorite-card" key={version.id}>
                    <div className="favorite-media">
                      <span className="favorite-dot" />
                      <span className="favorite-channel">{version.channel}</span>
                    </div>
                    <div className="favorite-body">
                      <h3>{version.name}</h3>
                      <p className="favorite-path">{version.path}</p>
                    </div>
                    <button className="card-action card-action-secondary" type="button">
                      Launch
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="release-page shelf-panel-first">
            <section className="release-hero">
              <div>
                <p className="section-kicker">Official Release Downloads</p>
                <h2>Stable builds for {releaseListing?.platformLabel ?? "this platform"}</h2>
              </div>

              <div className="release-hero-actions">
                <span className="section-badge">{releaseDownloads.length} downloads found</span>
                <span className="section-badge">{favoriteReleaseIds.length} favorites</span>
                <button className="card-action card-action-secondary" type="button" onClick={() => void refreshReleasePageData()}>
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
                  <span>Version</span>
                  <span>Channel</span>
                  <span>Release date</span>
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
                      <div className="release-primary">
                        <strong>{download.version}</strong>
                      </div>
                      <div>
                        <span className="release-channel-chip">{download.channel}</span>
                      </div>
                      <div className="release-package">{download.releaseDate}</div>
                      <div className="release-actions">
                        {isInstalled ? (
                          <>
                            <Tooltip content={`Launch Blender ${download.version}`}>
                              <button
                                className="release-launch-button"
                                type="button"
                                onClick={() => void launchInstalledRelease(installedVersion!)}
                                aria-label={`Launch Blender ${download.version}`}
                              >
                                <Play className="release-launch-icon" aria-hidden="true" fill="currentColor" strokeWidth={1.75} />
                              </button>
                            </Tooltip>

                            <Tooltip content={isFavorite ? "Remove favorite" : "Mark as favorite"}>
                              <button
                                className={isFavorite ? "favorite-button favorite-button-active" : "favorite-button"}
                                type="button"
                                onClick={() => toggleFavorite(download)}
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
                            onClick={() => void cancelInstall(download)}
                          >
                            {installStatus?.phase === "canceling" ? "Canceling..." : "Cancel"}
                          </button>
                        ) : (
                          <button
                            className={isInstalled ? "card-action card-action-secondary card-action-installed" : "card-action card-action-link"}
                            type="button"
                            onClick={isInstalled ? () => openUninstallDialog(download) : () => void installRelease(download)}
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
        )}
      </section>
      <ConfirmDialog
        open={pendingUninstallDownload !== null}
        title={pendingUninstallDownload ? `Remove Blender ${pendingUninstallDownload.version}?` : "Remove Blender?"}
        description={
          pendingUninstallDownload ? (
            <>
              <p>This will uninstall the managed Blender build from Voxel Shift.</p>

              <p>This also removes it from your favorites.</p>
            </>
          ) : (
            "This will uninstall the selected Blender build."
          )
        }
        errorMessage={removeVersionError}
        confirmLabel="Remove version"
        cancelLabel="Keep it"
        isConfirming={isRemovingVersion}
        onConfirm={confirmUninstall}
        onCancel={closeUninstallDialog}
      />
    </main>
  );
}


