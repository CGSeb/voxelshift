import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useEffectEvent, useState } from "react";
import { AppUpdateToast } from "./components/AppUpdateToast";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ReleaseConfigDialog } from "./components/releases/ReleaseConfigDialog";
import { AppFooter } from "./components/layout/AppFooter";
import { AppLayout } from "./components/layout/AppLayout";
import type { PageKey } from "./components/layout/AppMenu";
import {
  applyBlenderConfig,
  cancelBlenderReleaseInstall,
  getBlenderConfigs,
  getBlenderReleaseDownloads,
  getLauncherState,
  getRecentProjects,
  installBlenderRelease,
  launchBlender,
  launchBlenderProject,
  removeBlenderConfig,
  removeBlenderVersion,
  saveBlenderConfig,
} from "./lib/api";
import { checkForAppUpdate, type AppUpdate, type AppUpdateDownloadEvent, type AppUpdateInfo } from "./lib/updater";
import { HomePage } from "./pages/HomePage";
import { ReleasesPage } from "./pages/ReleasesPage";
import type {
  BlenderConfigProfile,
  BlenderReleaseDownload,
  BlenderReleaseInstallProgress,
  BlenderReleaseListing,
  BlenderVersion,
  LauncherState,
  RecentProject,
  ReleaseInstallPhase,
} from "./types";

const favoriteReleaseStorageKey = "voxelshift.favorite-release-downloads";
const releaseInstallEvent = "release-install-progress";
const installCanceledMessage = "Installation canceled.";

type AppUpdatePhase = "checking" | "idle" | "available" | "downloading" | "installing" | "completed" | "failed" | "unavailable";
type AppFooterTone = "neutral" | "success" | "warning" | "danger";
type ConfigDialogMode = "save" | "apply";

const pageMeta: Record<PageKey, { eyebrow: string; title: string; description: string }> = {
  home: {
    eyebrow: "",
    title: "",
    description: "",
  },
  releases: {
    eyebrow: "Release Library",
    title: "",
    description: "",
  },
};

function persistFavoriteReleaseValues(values: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify(values));
}

function readFavoriteReleaseValues() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(favoriteReleaseStorageKey);
    if (!raw) {
      return [] as string[];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
  } catch {
    return [] as string[];
  }
}

function isLegacyFavoriteReleaseId(value: string) {
  return value.startsWith("release-");
}

function uniqueFavoriteValues(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    next.push(trimmed);
  }

  return next;
}

function haveSameValues(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function makeAppUpdateInfo(update: AppUpdate): AppUpdateInfo {
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date,
    body: update.body,
    rawJson: update.rawJson,
  };
}

function isManagedInstall(version: BlenderVersion) {
  const normalizedInstallDir = version.installDir.replaceAll("\\", "/").toLowerCase();
  return normalizedInstallDir.includes("/voxelshift/stable/");
}

function defaultConfigNameForVersion(version: BlenderVersion) {
  return version.version ?? version.displayName;
}

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [releaseListing, setReleaseListing] = useState<BlenderReleaseListing | null>(null);
  const [launcherState, setLauncherState] = useState<LauncherState | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [installStatuses, setInstallStatuses] = useState<Record<string, BlenderReleaseInstallProgress>>({});
  const [isLoadingReleases, setIsLoadingReleases] = useState(false);
  const [isLoadingHome, setIsLoadingHome] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [favoriteReleaseValues, setFavoriteReleaseValues] = useState<string[]>(() => readFavoriteReleaseValues());
  const [pendingUninstallDownload, setPendingUninstallDownload] = useState<BlenderReleaseDownload | null>(null);
  const [isRemovingVersion, setIsRemovingVersion] = useState(false);
  const [removeVersionError, setRemoveVersionError] = useState<string | null>(null);
  const [activeConfigVersion, setActiveConfigVersion] = useState<BlenderVersion | null>(null);
  const [activeConfigDialogMode, setActiveConfigDialogMode] = useState<ConfigDialogMode | null>(null);
  const [blenderConfigs, setBlenderConfigs] = useState<BlenderConfigProfile[]>([]);
  const [blenderConfigName, setBlenderConfigName] = useState("");
  const [blenderConfigError, setBlenderConfigError] = useState<string | null>(null);
  const [blenderConfigNotice, setBlenderConfigNotice] = useState<string | null>(null);
  const [isLoadingBlenderConfigs, setIsLoadingBlenderConfigs] = useState(false);
  const [isSavingBlenderConfig, setIsSavingBlenderConfig] = useState(false);
  const [applyingBlenderConfigId, setApplyingBlenderConfigId] = useState<string | null>(null);
  const [pendingRemoveBlenderConfig, setPendingRemoveBlenderConfig] = useState<BlenderConfigProfile | null>(null);
  const [isRemovingBlenderConfig, setIsRemovingBlenderConfig] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdate | null>(null);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [appUpdatePhase, setAppUpdatePhase] = useState<AppUpdatePhase>("checking");
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  const [isAppUpdateToastOpen, setIsAppUpdateToastOpen] = useState(false);
  const [appUpdateDownloadedBytes, setAppUpdateDownloadedBytes] = useState(0);
  const [appUpdateTotalBytes, setAppUpdateTotalBytes] = useState<number | null>(null);
  const [appUpdateProgressPercent, setAppUpdateProgressPercent] = useState<number | null>(null);

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

  useEffect(() => {
    let isDisposed = false;

    async function loadAppVersion() {
      try {
        const version = await getVersion();
        if (!isDisposed) {
          setAppVersion(version);
        }
      } catch {
        if (!isDisposed) {
          setAppVersion(null);
        }
      }
    }

    void loadAppVersion();

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;

    async function loadAppUpdate() {
      setAppUpdatePhase("checking");
      setAppUpdateError(null);

      try {
        const nextUpdate = await checkForAppUpdate();

        if (isDisposed) {
          if (nextUpdate) {
            void nextUpdate.close();
          }
          return;
        }

        setAppUpdate(nextUpdate);

        if (nextUpdate) {
          setAppUpdateInfo(makeAppUpdateInfo(nextUpdate));
          setAppUpdatePhase("available");
          setIsAppUpdateToastOpen(true);
        } else {
          setAppUpdateInfo(null);
          setAppUpdatePhase("idle");
        }
      } catch (error) {
        if (isDisposed) {
          return;
        }

        setAppUpdate(null);
        setAppUpdateInfo(null);
        setAppUpdatePhase("unavailable");
        setAppUpdateError(readErrorMessage(error, "Could not check for Voxel Shift updates."));
      }
    }

    void loadAppUpdate();

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (appUpdate) {
        void appUpdate.close();
      }
    };
  }, [appUpdate]);

  async function refreshHomePageData(options?: { silent?: boolean }) {
    const isSilent = options?.silent ?? false;

    if (!isSilent) {
      setIsLoadingHome(true);
    }

    setHomeError(null);

    const [launcherResult, recentProjectsResult] = await Promise.allSettled([getLauncherState(), getRecentProjects()]);

    if (launcherResult.status === "fulfilled") {
      setLauncherState(launcherResult.value);
    } else {
      setLauncherState(null);
      setHomeError(readErrorMessage(launcherResult.reason, "Could not load your installed Blender versions."));
    }

    if (recentProjectsResult.status === "fulfilled") {
      setRecentProjects(recentProjectsResult.value);
    } else {
      setRecentProjects([]);
      setHomeError(readErrorMessage(recentProjectsResult.reason, "Could not load recent Blender projects."));
    }

    if (!isSilent) {
      setIsLoadingHome(false);
    }
  }

  const refreshHomePageDataEvent = useEffectEvent(async (options?: { silent?: boolean }) => {
    await refreshHomePageData(options);
  });

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
    if (activePage !== "home") {
      return;
    }

    let isDisposed = false;
    let isRefreshing = false;

    async function refreshWithGuard() {
      if (isDisposed || isRefreshing) {
        return;
      }

      isRefreshing = true;

      try {
        await refreshHomePageDataEvent();
      } finally {
        isRefreshing = false;
      }
    }

    void refreshWithGuard();

    const intervalId = window.setInterval(() => {
      if (isDisposed || isRefreshing) {
        return;
      }

      isRefreshing = true;

      void refreshHomePageDataEvent({ silent: true }).finally(() => {
        isRefreshing = false;
      });
    }, 10_000);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, [activePage]);

  useEffect(() => {
    if (activePage !== "releases" || releaseListing) {
      return;
    }

    void refreshReleasePageData();
  }, [activePage, releaseListing]);

  useEffect(() => {
    if (!releaseListing) {
      return;
    }

    const downloads = [
      ...releaseListing.stableDownloads,
      ...releaseListing.experimentalGroups.flatMap((group) => group.downloads),
    ];

    const nextValues = uniqueFavoriteValues(
      favoriteReleaseValues.flatMap((value) => {
        if (!isLegacyFavoriteReleaseId(value)) {
          return [value];
        }

        const matchingDownload = downloads.find((download) => download.id === value);
        return matchingDownload ? [matchingDownload.version] : [value];
      }),
    );

    if (haveSameValues(nextValues, favoriteReleaseValues)) {
      return;
    }

    persistFavoriteReleaseValues(nextValues);
    setFavoriteReleaseValues(nextValues);
  }, [favoriteReleaseValues, releaseListing]);

  function toggleFavorite(download: BlenderReleaseDownload) {
    setFavoriteReleaseValues((current) => {
      const isFavorite = current.includes(download.version) || current.includes(download.id);
      const next = isFavorite
        ? current.filter((value) => value !== download.version && value !== download.id)
        : uniqueFavoriteValues([...current.filter((value) => value !== download.id), download.version]);

      persistFavoriteReleaseValues(next);
      return next;
    });
  }

  function removeFavorite(versionNumber: string) {
    setFavoriteReleaseValues((current) => {
      const next = current.filter((value) => value !== versionNumber);
      if (haveSameValues(next, current)) {
        return current;
      }

      persistFavoriteReleaseValues(next);
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
      setHomeError(null);
    } catch (error) {
      const message = readErrorMessage(error, `Could not launch Blender ${version.version ?? version.displayName}.`);
      setReleaseError(message);
      setHomeError(message);
    }
  }

  async function openRecentProject(project: RecentProject) {
    if (!project.exists) {
      setHomeError(`The Blender file could not be found: ${project.filePath}`);
      return;
    }

    try {
      const nextLauncherState = await launchBlenderProject({
        id: project.blenderId,
        projectPath: project.filePath,
      });
      setLauncherState(nextLauncherState);
      setHomeError(null);
    } catch (error) {
      setHomeError(readErrorMessage(error, `Could not open ${project.name}.`));
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

  async function loadBlenderConfigs() {
    setIsLoadingBlenderConfigs(true);

    try {
      const nextConfigs = await getBlenderConfigs();
      setBlenderConfigs(nextConfigs);
      setBlenderConfigError(null);
    } catch (error) {
      setBlenderConfigs([]);
      setBlenderConfigError(readErrorMessage(error, "Could not load saved Blender configs."));
    } finally {
      setIsLoadingBlenderConfigs(false);
    }
  }

  function openConfigDialog(version: BlenderVersion, mode: ConfigDialogMode) {
    setActiveConfigVersion(version);
    setActiveConfigDialogMode(mode);
    setBlenderConfigs([]);
    setBlenderConfigName(defaultConfigNameForVersion(version));
    setBlenderConfigError(null);
    setBlenderConfigNotice(null);
    if (mode === "apply") {
      void loadBlenderConfigs();
    }
  }

  function closeConfigDialog() {
    if (isSavingBlenderConfig || applyingBlenderConfigId !== null || isRemovingBlenderConfig) {
      return;
    }

    setActiveConfigVersion(null);
    setActiveConfigDialogMode(null);
    setPendingRemoveBlenderConfig(null);
    setBlenderConfigError(null);
    setBlenderConfigNotice(null);
  }

  function requestRemoveBlenderConfig(config: BlenderConfigProfile) {
    setPendingRemoveBlenderConfig(config);
    setBlenderConfigError(null);
    setBlenderConfigNotice(null);
  }

  function closeRemoveBlenderConfigDialog() {
    if (isRemovingBlenderConfig) {
      return;
    }

    setPendingRemoveBlenderConfig(null);
  }

  async function saveCurrentBlenderConfig() {
    if (!activeConfigVersion) {
      return;
    }

    setIsSavingBlenderConfig(true);
    setBlenderConfigError(null);
    setBlenderConfigNotice(null);

    try {
      const savedConfig = await saveBlenderConfig({
        versionId: activeConfigVersion.id,
        name: blenderConfigName,
      });
      setBlenderConfigName(savedConfig.name);
      setBlenderConfigNotice(`Saved ${savedConfig.name}.`);
    } catch (error) {
      setBlenderConfigError(readErrorMessage(error, `Could not save Blender ${defaultConfigNameForVersion(activeConfigVersion)} config.`));
    } finally {
      setIsSavingBlenderConfig(false);
    }
  }

  async function applySavedBlenderConfig(config: BlenderConfigProfile) {
    if (!activeConfigVersion) {
      return;
    }

    setApplyingBlenderConfigId(config.id);
    setBlenderConfigError(null);
    setBlenderConfigNotice(null);

    try {
      await applyBlenderConfig({
        versionId: activeConfigVersion.id,
        configId: config.id,
      });
      setActiveConfigVersion(null);
      setActiveConfigDialogMode(null);
      setPendingRemoveBlenderConfig(null);
    } catch (error) {
      setBlenderConfigError(readErrorMessage(error, `Could not apply ${config.name}.`));
    } finally {
      setApplyingBlenderConfigId(null);
    }
  }

  async function confirmRemoveBlenderConfig() {
    if (!pendingRemoveBlenderConfig) {
      return;
    }

    setIsRemovingBlenderConfig(true);
    setBlenderConfigError(null);
    setBlenderConfigNotice(null);

    try {
      await removeBlenderConfig(pendingRemoveBlenderConfig.id);
      setPendingRemoveBlenderConfig(null);
      setBlenderConfigNotice(`Removed ${pendingRemoveBlenderConfig.name}.`);
      setBlenderConfigs(await getBlenderConfigs());
    } catch (error) {
      setBlenderConfigError(readErrorMessage(error, `Could not remove ${pendingRemoveBlenderConfig.name}.`));
    } finally {
      setIsRemovingBlenderConfig(false);
    }
  }

  async function installAvailableAppUpdate() {
    if (!appUpdate || (appUpdatePhase !== "available" && appUpdatePhase !== "failed")) {
      return;
    }

    setIsAppUpdateToastOpen(true);
    setAppUpdateError(null);
    setAppUpdateDownloadedBytes(0);
    setAppUpdateTotalBytes(null);
    setAppUpdateProgressPercent(null);
    setAppUpdatePhase("downloading");

    let downloadedBytes = 0;
    let totalBytes: number | null = null;

    try {
      await appUpdate.downloadAndInstall((event: AppUpdateDownloadEvent) => {
        if (event.event === "Started") {
          downloadedBytes = 0;
          totalBytes = event.data.contentLength ?? null;
          setAppUpdateDownloadedBytes(0);
          setAppUpdateTotalBytes(totalBytes);
          setAppUpdateProgressPercent(totalBytes ? 0 : null);
          setAppUpdatePhase("downloading");
          return;
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          setAppUpdateDownloadedBytes(downloadedBytes);
          setAppUpdateProgressPercent(totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null);
          return;
        }

        if (totalBytes !== null) {
          setAppUpdateDownloadedBytes(totalBytes);
          setAppUpdateProgressPercent(100);
        }
        setAppUpdatePhase("installing");
      });

      setAppUpdatePhase("completed");
      setAppUpdateError(null);
      setAppUpdateProgressPercent(100);
      if (totalBytes !== null) {
        setAppUpdateDownloadedBytes(totalBytes);
      }
      setAppUpdate(null);
    } catch (error) {
      setAppUpdatePhase("failed");
      setAppUpdateError(readErrorMessage(error, "Could not update Voxel Shift."));
    }
  }

  function openAppUpdateToast() {
    if (!appUpdateInfo && !appUpdateError) {
      return;
    }

    setIsAppUpdateToastOpen(true);
  }

  function closeAppUpdateToast() {
    if (appUpdatePhase === "downloading" || appUpdatePhase === "installing") {
      return;
    }

    setIsAppUpdateToastOpen(false);
  }

  const installedReleaseVersions = new Map<string, BlenderVersion>();

  for (const version of launcherState?.versions ?? []) {
    if (!version.available || !version.version || !isManagedInstall(version) || installedReleaseVersions.has(version.version)) {
      continue;
    }

    installedReleaseVersions.set(version.version, version);
  }

  const favoriteReleaseVersions = favoriteReleaseValues.filter((value) => !isLegacyFavoriteReleaseId(value));
  const favoriteInstalledVersions = favoriteReleaseVersions
    .map((versionNumber) => installedReleaseVersions.get(versionNumber))
    .filter((version): version is BlenderVersion => Boolean(version));

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
      removeFavorite(pendingUninstallDownload.version);
      setPendingUninstallDownload(null);
      if (activePage === "home") {
        void refreshHomePageData();
      }
    } catch (error) {
      setRemoveVersionError(readErrorMessage(error, `Could not remove Blender ${pendingUninstallDownload.version}.`));
    } finally {
      setIsRemovingVersion(false);
    }
  }

  const activeMeta = pageMeta[activePage];
  const isCheckingForAppUpdates = appUpdatePhase === "checking";
  const isUpdatingApp = appUpdatePhase === "downloading" || appUpdatePhase === "installing";
  const canInstallAppUpdate = Boolean(appUpdate) && (appUpdatePhase === "available" || appUpdatePhase === "failed");
  const canDismissAppUpdateToast = appUpdatePhase !== "downloading" && appUpdatePhase !== "installing";
  const shouldShowAppUpdateToast = isAppUpdateToastOpen && Boolean(appUpdateInfo || appUpdateError);
  const footerVersionLabel = appVersion ?? appUpdateInfo?.currentVersion ?? null;
  const appUpdateActionLabel = canInstallAppUpdate
    ? appUpdatePhase === "failed"
      ? "Retry update"
      : appUpdateInfo
        ? `Update to v${appUpdateInfo.version}`
        : "Install update"
    : null;
  const appUpdateDetailsLabel = appUpdateInfo ? (shouldShowAppUpdateToast ? null : "Details") : null;

  let appUpdateSummary = "You're up to date";
  let appUpdateTone: AppFooterTone = "neutral";
  let footerUpdateVersion = appUpdateInfo?.version ?? null;

  switch (appUpdatePhase) {
    case "checking":
      appUpdateSummary = "Checking for updates";
      break;
    case "available":
      appUpdateSummary = "Update available";
      appUpdateTone = "warning";
      footerUpdateVersion = null;
      break;
    case "downloading":
      appUpdateSummary = appUpdateInfo ? `Downloading v${appUpdateInfo.version}` : "Downloading update";
      appUpdateTone = "warning";
      break;
    case "installing":
      appUpdateSummary = appUpdateInfo ? `Installing v${appUpdateInfo.version}` : "Installing update";
      appUpdateTone = "warning";
      break;
    case "completed":
      appUpdateSummary = appUpdateInfo ? `Installed v${appUpdateInfo.version}` : "Update installed";
      appUpdateTone = "success";
      break;
    case "failed":
      appUpdateSummary = appUpdateInfo ? `Update v${appUpdateInfo.version} failed` : "Update failed";
      appUpdateTone = "danger";
      break;
    case "unavailable":
      appUpdateSummary = "Updates unavailable";
      appUpdateTone = "danger";
      break;
    default:
      break;
  }

  return (
    <>
      <AppLayout
        activePage={activePage}
        onNavigate={setActivePage}
        eyebrow={activeMeta.eyebrow}
        title={activeMeta.title}
        description={activeMeta.description}
        footer={
          <AppFooter
            appVersion={footerVersionLabel}
            updateSummary={appUpdateSummary}
            updateTone={appUpdateTone}
            updateVersion={footerUpdateVersion}
            detailsLabel={appUpdateDetailsLabel}
            updateActionLabel={appUpdateActionLabel}
            isCheckingForUpdates={isCheckingForAppUpdates}
            isUpdating={isUpdatingApp}
            onInstallUpdate={canInstallAppUpdate ? () => void installAvailableAppUpdate() : null}
            onShowUpdateDetails={appUpdateInfo ? openAppUpdateToast : null}
          />
        }
      >
        {activePage === "home" ? (
          <HomePage
            recentProjects={recentProjects}
            favoriteVersions={favoriteInstalledVersions}
            errorMessage={homeError}
            onBrowseReleases={() => setActivePage("releases")}
            onOpenProject={(project) => void openRecentProject(project)}
            onLaunchVersion={(version) => void launchInstalledRelease(version)}
          />
        ) : (
          <ReleasesPage
            releaseListing={releaseListing}
            releaseError={releaseError}
            isLoadingReleases={isLoadingReleases}
            favoriteVersionCount={favoriteReleaseVersions.length}
            favoriteReleaseValues={favoriteReleaseValues}
            installStatuses={installStatuses}
            installedReleaseVersions={installedReleaseVersions}
            onRefresh={() => void refreshReleasePageData()}
            onInstall={(download) => void installRelease(download)}
            onCancelInstall={(download) => void cancelInstall(download)}
            onLaunchVersion={(version) => void launchInstalledRelease(version)}
            onOpenConfigs={(version, mode) => void openConfigDialog(version, mode)}
            onToggleFavorite={toggleFavorite}
            onOpenUninstall={openUninstallDialog}
          />
        )}
      </AppLayout>

      {shouldShowAppUpdateToast ? (
        <AppUpdateToast
          phase={appUpdatePhase}
          updateInfo={appUpdateInfo}
          errorMessage={appUpdateError}
          progressPercent={appUpdateProgressPercent}
          downloadedBytes={appUpdateDownloadedBytes}
          totalBytes={appUpdateTotalBytes}
          actionLabel={appUpdateActionLabel}
          canDismiss={canDismissAppUpdateToast}
          onInstallUpdate={canInstallAppUpdate ? () => void installAvailableAppUpdate() : null}
          onClose={closeAppUpdateToast}
        />
      ) : null}

      <ReleaseConfigDialog
        open={activeConfigVersion !== null && activeConfigDialogMode !== null}
        mode={activeConfigDialogMode ?? "save"}
        version={activeConfigVersion}
        configs={blenderConfigs}
        configName={blenderConfigName}
        isLoading={isLoadingBlenderConfigs}
        isSaving={isSavingBlenderConfig}
        applyingConfigId={applyingBlenderConfigId}
        deletingConfigId={isRemovingBlenderConfig ? pendingRemoveBlenderConfig?.id ?? null : null}
        errorMessage={blenderConfigError}
        noticeMessage={blenderConfigNotice}
        onConfigNameChange={setBlenderConfigName}
        onSave={() => void saveCurrentBlenderConfig()}
        onApply={(config) => void applySavedBlenderConfig(config)}
        onRequestRemove={requestRemoveBlenderConfig}
        onClose={closeConfigDialog}
      />

      <ConfirmDialog
        open={pendingRemoveBlenderConfig !== null}
        title={pendingRemoveBlenderConfig ? `Remove ${pendingRemoveBlenderConfig.name}?` : "Remove config?"}
        description={
          pendingRemoveBlenderConfig
            ? `This will permanently remove the saved config ${pendingRemoveBlenderConfig.name} from Documents/VoxelShift/configs.`
            : "This will permanently remove the saved config."
        }
        errorMessage={blenderConfigError}
        confirmLabel="Remove config"
        cancelLabel="Keep it"
        isConfirming={isRemovingBlenderConfig}
        onConfirm={confirmRemoveBlenderConfig}
        onCancel={closeRemoveBlenderConfigDialog}
      />

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



