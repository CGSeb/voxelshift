import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { AppLayout } from "./components/layout/AppLayout";
import type { PageKey } from "./components/layout/AppMenu";
import {
  cancelBlenderReleaseInstall,
  getBlenderReleaseDownloads,
  getLauncherState,
  installBlenderRelease,
  launchBlender,
  removeBlenderVersion,
} from "./lib/api";
import { HomePage } from "./pages/HomePage";
import { ReleasesPage } from "./pages/ReleasesPage";
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
const installCanceledMessage = "Installation canceled.";

const pageMeta: Record<PageKey, { eyebrow: string; title: string; description: string }> = {
  home: {
    eyebrow: "Workspace",
    title: "Create from one launcher home",
    description: "Keep recent project shortcuts, favorite builds, and release management inside a single navigation shell.",
  },
  releases: {
    eyebrow: "Release Library",
    title: "",
    description: "",
  },
};

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

function makeFallbackInstallStatus(
  download: BlenderReleaseDownload,
  message: string,
  phase: ReleaseInstallPhase,
): BlenderReleaseInstallProgress {
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

  const installedReleaseVersions = new Map<string, BlenderVersion>();

  for (const version of launcherState?.versions ?? []) {
    if (!version.available || !version.version || !isManagedInstall(version) || installedReleaseVersions.has(version.version)) {
      continue;
    }

    installedReleaseVersions.set(version.version, version);
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

  const activeMeta = pageMeta[activePage];

  return (
    <>
      <AppLayout
        activePage={activePage}
        onNavigate={setActivePage}
        eyebrow={activeMeta.eyebrow}
        title={activeMeta.title}
        description={activeMeta.description}
      >
        {activePage === "home" ? (
          <HomePage favoriteCount={favoriteReleaseIds.length} managedInstallCount={installedReleaseVersions.size} />
        ) : (
          <ReleasesPage
            releaseListing={releaseListing}
            releaseError={releaseError}
            isLoadingReleases={isLoadingReleases}
            favoriteReleaseIds={favoriteReleaseIds}
            installStatuses={installStatuses}
            installedReleaseVersions={installedReleaseVersions}
            onRefresh={() => void refreshReleasePageData()}
            onInstall={(download) => void installRelease(download)}
            onCancelInstall={(download) => void cancelInstall(download)}
            onLaunchVersion={(version) => void launchInstalledRelease(version)}
            onToggleFavorite={toggleFavorite}
            onOpenUninstall={openUninstallDialog}
          />
        )}
      </AppLayout>

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
    </>
  );
}
