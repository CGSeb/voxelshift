import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useEffectEvent, useState } from "react";
import { AppUpdateToast } from "./components/AppUpdateToast";
import { BlenderLogsDialog } from "./components/BlenderLogsDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PlannerLogsDialog } from "./components/PlannerLogsDialog";
import { ReleaseConfigDialog } from "./components/releases/ReleaseConfigDialog";
import { AppFooter } from "./components/layout/AppFooter";
import { AppLayout } from "./components/layout/AppLayout";
import { RunningBlenderTray } from "./components/layout/RunningBlenderTray";
import type { PageKey } from "./components/layout/AppMenu";
import {
  applyBlenderConfig,
  cancelBlenderReleaseInstall,
  createPlannerRun,
  deletePlannerRun,
  updatePlannerRun,
  getBlenderConfigs,
  getBlenderReleaseDownloads,
  getLauncherState,
  getPlannerLogs,
  getPlannerRuns,
  getRecentProjects,
  refreshManagedBlenderExtensions,
  getRunningBlenderLogs,
  getRunningBlenders,
  installBlenderRelease,
  launchBlender,
  launchBlenderProject,
  pickPlannerBlendFile,
  pickPlannerBlenderExecutable,
  pickPlannerOutputFolder,
  removeBlenderConfig,
  removeRecentProject,
  removeBlenderVersion,
  saveBlenderConfig,
  stopRunningBlender,
} from "./lib/api";
import { checkForAppUpdate, type AppUpdate, type AppUpdateDownloadEvent, type AppUpdateInfo } from "./lib/updater";
import { HomePage } from "./pages/HomePage";
import { PlannerPage } from "./pages/PlannerPage";
import { ReleasesPage } from "./pages/ReleasesPage";
import type {
  BlenderConfigProfile,
  BlenderLogEntry,
  BlenderLogEvent,
  BlenderReleaseDownload,
  BlenderReleaseInstallProgress,
  BlenderReleaseListing,
  BlenderSession,
  BlenderVersion,
  LauncherState,
  PlannerLogEntry,
  PlannerLogEvent,
  PlannerRunSummary,
  RecentProject,
  ReleaseInstallPhase,
  RunningBlenderProcess,
} from "./types";

const favoriteReleaseStorageKey = "voxelshift.favorite-release-downloads";
const releaseInstallEvent = "release-install-progress";
const runningBlendersEvent = "running-blenders-updated";
const runningBlenderLogEvent = "running-blender-log";
const plannerRunsEvent = "planner-runs-updated";
const plannerLogEvent = "planner-log";
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
  planner: {
    eyebrow: "Planner",
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

const maxClosedBlenderSessionsPerProjectVersion = 1;

function normalizeBlenderSessionProjectPath(projectPath: string | null) {
  if (!projectPath) {
    return "";
  }

  return projectPath.replaceAll("/", "\\").trim().toLowerCase();
}

function makeBlenderSessionGroupKey(
  process: Pick<RunningBlenderProcess, "blenderVersion" | "blenderDisplayName" | "projectPath">,
) {
  const versionKey = process.blenderVersion ?? process.blenderDisplayName;
  const projectKey = normalizeBlenderSessionProjectPath(process.projectPath);
  return `${versionKey}::${projectKey}`;
}

function getBlenderSessionSortTimestamp(session: BlenderSession) {
  return session.isRunning ? session.startedAt : session.closedAt ?? session.startedAt;
}

function sortBlenderSessions(left: BlenderSession, right: BlenderSession) {
  if (left.isRunning !== right.isRunning) {
    return left.isRunning ? -1 : 1;
  }

  const timestampDifference = getBlenderSessionSortTimestamp(right) - getBlenderSessionSortTimestamp(left);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return right.startedAt - left.startedAt;
}

function limitBlenderSessions(sessions: BlenderSession[]) {
  const groupedSessions = new Map<string, BlenderSession[]>();

  for (const session of [...sessions].sort(sortBlenderSessions)) {
    const groupKey = makeBlenderSessionGroupKey(session);
    const group = groupedSessions.get(groupKey);
    if (group) {
      group.push(session);
      continue;
    }

    groupedSessions.set(groupKey, [session]);
  }

  const limitedSessions: BlenderSession[] = [];

  for (const group of groupedSessions.values()) {
    const runningSessions = group.filter((session) => session.isRunning);
    const closedSessions = group.filter((session) => !session.isRunning);

    limitedSessions.push(...runningSessions, ...closedSessions.slice(0, maxClosedBlenderSessionsPerProjectVersion));
  }

  return limitedSessions.sort(sortBlenderSessions);
}

function mergeBlenderSessions(currentSessions: BlenderSession[], runningProcesses: RunningBlenderProcess[]) {
  const nextSessions = new Map<string, BlenderSession>();

  for (const session of currentSessions) {
    nextSessions.set(session.instanceId, {
      ...session,
      logs: [...session.logs],
    });
  }

  const runningIds = new Set(runningProcesses.map((process) => process.instanceId));

  for (const process of runningProcesses) {
    const existingSession = nextSessions.get(process.instanceId);
    nextSessions.set(process.instanceId, {
      ...existingSession,
      ...process,
      isRunning: true,
      closedAt: null,
      logs: existingSession?.logs ?? [],
    });
  }

  const closedAt = Math.floor(Date.now() / 1000);

  for (const [instanceId, session] of nextSessions.entries()) {
    if (runningIds.has(instanceId) || !session.isRunning) {
      continue;
    }

    nextSessions.set(instanceId, {
      ...session,
      isRunning: false,
      isStopping: false,
      closedAt: session.closedAt ?? closedAt,
    });
  }

  return limitBlenderSessions([...nextSessions.values()]);
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
  const [pendingRemoveRecentProject, setPendingRemoveRecentProject] = useState<RecentProject | null>(null);
  const [isRemovingRecentProject, setIsRemovingRecentProject] = useState(false);
  const [removeRecentProjectError, setRemoveRecentProjectError] = useState<string | null>(null);
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
  const [runningBlenders, setRunningBlenders] = useState<RunningBlenderProcess[]>([]);
  const [blenderSessions, setBlenderSessions] = useState<BlenderSession[]>([]);
  const [isRunningBlenderTrayOpen, setIsRunningBlenderTrayOpen] = useState(false);
  const [activeLogsProcessId, setActiveLogsProcessId] = useState<string | null>(null);
  const [pendingStopBlenderId, setPendingStopBlenderId] = useState<string | null>(null);
  const [stopBlenderError, setStopBlenderError] = useState<string | null>(null);
  const [stoppingBlenderId, setStoppingBlenderId] = useState<string | null>(null);
  const [plannerRuns, setPlannerRuns] = useState<PlannerRunSummary[]>([]);
  const [plannerLogsByRunId, setPlannerLogsByRunId] = useState<Record<string, PlannerLogEntry[]>>({});
  const [isLoadingPlanner, setIsLoadingPlanner] = useState(false);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [isCreatingPlannerRun, setIsCreatingPlannerRun] = useState(false);
  const [plannerCreateError, setPlannerCreateError] = useState<string | null>(null);
  const [plannerNotice, setPlannerNotice] = useState<string | null>(null);
  const [activePlannerLogsRunId, setActivePlannerLogsRunId] = useState<string | null>(null);

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

    async function loadRunningBlenders() {
      try {
        const processes = await getRunningBlenders();
        if (!isDisposed) {
          setRunningBlenders(processes);
          setBlenderSessions((current) => mergeBlenderSessions(current, processes));
        }
      } catch {
        if (!isDisposed) {
          setRunningBlenders([]);
          setBlenderSessions((current) => mergeBlenderSessions(current, []));
        }
      }
    }

    void loadRunningBlenders();

    return () => {
      isDisposed = true;
    };
  }, []);

  const handleRunningBlenderLogEvent = useEffectEvent((payload: BlenderLogEvent) => {
    setBlenderSessions((current) => {
      const sessionIndex = current.findIndex((session) => session.instanceId === payload.instanceId);
      if (sessionIndex === -1) {
        return current;
      }

      const session = current[sessionIndex];
      if (session.logs.some((entry) => entry.id === payload.entry.id)) {
        return current;
      }

      const nextSessions = [...current];
      nextSessions[sessionIndex] = {
        ...session,
        logs: [...session.logs, payload.entry],
      };

      return limitBlenderSessions(nextSessions);
    });
  });

  const handlePlannerLogEvent = useEffectEvent((payload: PlannerLogEvent) => {
    setPlannerLogsByRunId((current) => {
      const existingLogs = current[payload.runId] ?? [];
      if (existingLogs.some((entry) => entry.id === payload.entry.id)) {
        return current;
      }

      return {
        ...current,
        [payload.runId]: [...existingLogs, payload.entry],
      };
    });
  });

  useEffect(() => {
    let isDisposed = false;

    async function loadPlannerRuns() {
      setIsLoadingPlanner(true);
      setPlannerError(null);

      try {
        const runs = await getPlannerRuns();
        if (!isDisposed) {
          setPlannerRuns(runs);
        }
      } catch (error) {
        if (!isDisposed) {
          setPlannerRuns([]);
          setPlannerError(readErrorMessage(error, "Could not load planner runs."));
        }
      } finally {
        if (!isDisposed) {
          setIsLoadingPlanner(false);
        }
      }
    }

    void loadPlannerRuns();

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let isDisposed = false;

    async function subscribeToPlannerRuns() {
      unlisten = await listen<PlannerRunSummary[]>(plannerRunsEvent, (event) => {
        if (isDisposed) {
          return;
        }

        setPlannerRuns(event.payload);
        setPlannerError(null);
      });
    }

    void subscribeToPlannerRuns();

    return () => {
      isDisposed = true;
      if (unlisten) {
        void unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let isDisposed = false;

    async function subscribeToPlannerLogs() {
      unlisten = await listen<PlannerLogEvent>(plannerLogEvent, (event) => {
        if (isDisposed) {
          return;
        }

        handlePlannerLogEvent(event.payload);
      });
    }

    void subscribeToPlannerLogs();

    return () => {
      isDisposed = true;
      if (unlisten) {
        void unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let isDisposed = false;

    async function subscribeToRunningBlenders() {
      unlisten = await listen<RunningBlenderProcess[]>(runningBlendersEvent, (event) => {
        if (isDisposed) {
          return;
        }

        setRunningBlenders(event.payload);
        setBlenderSessions((current) => mergeBlenderSessions(current, event.payload));
      });
    }

    void subscribeToRunningBlenders();

    return () => {
      isDisposed = true;
      if (unlisten) {
        void unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let isDisposed = false;

    async function subscribeToRunningBlenderLogs() {
      unlisten = await listen<BlenderLogEvent>(runningBlenderLogEvent, (event) => {
        if (isDisposed) {
          return;
        }

        handleRunningBlenderLogEvent(event.payload);
      });
    }

    void subscribeToRunningBlenderLogs();

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

  function openRemoveRecentProjectDialog(project: RecentProject) {
    setPendingRemoveRecentProject(project);
    setRemoveRecentProjectError(null);
  }

  function closeRemoveRecentProjectDialog() {
    if (isRemovingRecentProject) {
      return;
    }

    setPendingRemoveRecentProject(null);
    setRemoveRecentProjectError(null);
  }

  async function confirmRemoveRecentProject() {
    if (!pendingRemoveRecentProject) {
      return;
    }

    setIsRemovingRecentProject(true);
    setRemoveRecentProjectError(null);

    try {
      const nextRecentProjects = await removeRecentProject(pendingRemoveRecentProject.filePath);
      setRecentProjects(nextRecentProjects);
      setPendingRemoveRecentProject(null);
      setHomeError(null);
    } catch (error) {
      setRemoveRecentProjectError(readErrorMessage(error, `Could not remove ${pendingRemoveRecentProject.name}.`));
    } finally {
      setIsRemovingRecentProject(false);
    }
  }

  async function openRunningBlenderLogs(process: BlenderSession) {
    setActiveLogsProcessId(process.instanceId);

    if (!process.isRunning) {
      return;
    }

    try {
      const logs = await getRunningBlenderLogs(process.instanceId);
      setBlenderSessions((current) => {
        const sessionIndex = current.findIndex((session) => session.instanceId === process.instanceId);
        if (sessionIndex === -1) {
          return current;
        }

        const session = current[sessionIndex];
        const mergedLogs = new Map<string, BlenderLogEntry>();

        for (const entry of [...session.logs, ...logs]) {
          mergedLogs.set(entry.id, entry);
        }

        const nextSessions = [...current];
        nextSessions[sessionIndex] = {
          ...session,
          logs: [...mergedLogs.values()].sort((left, right) => left.timestamp - right.timestamp),
        };

        return limitBlenderSessions(nextSessions);
      });
    } catch (error) {
      const errorEntry: BlenderLogEntry = {
        id: `${process.instanceId}-log-error-${Date.now()}`,
        instanceId: process.instanceId,
        source: "system",
        message: readErrorMessage(error, "Could not load Blender logs."),
        timestamp: Math.floor(Date.now() / 1000),
      };

      setBlenderSessions((current) => {
        const sessionIndex = current.findIndex((session) => session.instanceId === process.instanceId);
        if (sessionIndex === -1) {
          return current;
        }

        const session = current[sessionIndex];
        const nextSessions = [...current];
        nextSessions[sessionIndex] = {
          ...session,
          logs: [...session.logs, errorEntry],
        };

        return limitBlenderSessions(nextSessions);
      });
    }
  }

  function closeRunningBlenderLogs() {
    setActiveLogsProcessId(null);
  }

  async function openPlannerLogs(run: PlannerRunSummary) {
    setActivePlannerLogsRunId(run.id);

    try {
      const logs = await getPlannerLogs(run.id);
      setPlannerLogsByRunId((current) => ({
        ...current,
        [run.id]: logs,
      }));
    } catch (error) {
      const errorEntry: PlannerLogEntry = {
        id: `${run.id}-planner-error`,
        runId: run.id,
        source: "system",
        message: readErrorMessage(error, "Could not load planner logs."),
        timestamp: Math.floor(Date.now() / 1000),
      };
      setPlannerLogsByRunId((current) => ({
        ...current,
        [run.id]: [...(current[run.id] ?? []), errorEntry],
      }));
    }
  }

  function closePlannerLogs() {
    setActivePlannerLogsRunId(null);
  }

  async function browsePlannerBlendFile() {
    try {
      setPlannerCreateError(null);
      return await pickPlannerBlendFile();
    } catch (error) {
      setPlannerCreateError(readErrorMessage(error, "Could not open the Blender project picker."));
      return null;
    }
  }

  async function browsePlannerBlenderExecutable() {
    try {
      setPlannerCreateError(null);
      return await pickPlannerBlenderExecutable();
    } catch (error) {
      setPlannerCreateError(readErrorMessage(error, "Could not open the Blender picker."));
      return null;
    }
  }

  async function browsePlannerOutputFolder() {
    try {
      setPlannerCreateError(null);
      return await pickPlannerOutputFolder();
    } catch (error) {
      setPlannerCreateError(readErrorMessage(error, "Could not open the output folder picker."));
      return null;
    }
  }

  async function schedulePlannerRun(payload: Parameters<typeof createPlannerRun>[0]) {
    setIsCreatingPlannerRun(true);
    setPlannerCreateError(null);
    setPlannerNotice(null);

    try {
      const createdRun = await createPlannerRun(payload);
      setPlannerRuns((current) => {
        const nextRuns = [createdRun, ...current.filter((run) => run.id !== createdRun.id)];
        return nextRuns;
      });
      setPlannerNotice("Scheduled render added to Planner.");
      return true;
    } catch (error) {
      setPlannerCreateError(readErrorMessage(error, "Could not schedule this render."));
      return false;
    } finally {
      setIsCreatingPlannerRun(false);
    }
  }

  async function updatePlannerRunById(runId: string, payload: Parameters<typeof createPlannerRun>[0]) {
    setIsCreatingPlannerRun(true);
    setPlannerCreateError(null);
    setPlannerNotice(null);

    try {
      const updatedRun = await updatePlannerRun(runId, payload);
      setPlannerRuns((current) => current.map((run) => (run.id === runId ? updatedRun : run)));
      return true;
    } catch (error) {
      setPlannerCreateError(readErrorMessage(error, "Could not update this planned render."));
      return false;
    } finally {
      setIsCreatingPlannerRun(false);
    }
  }

  async function deletePlannerRunById(run: PlannerRunSummary) {
    setPlannerError(null);

    try {
      await deletePlannerRun(run.id);
      setPlannerRuns((current) => current.filter((plannerRun) => plannerRun.id !== run.id));
      setPlannerLogsByRunId((current) => {
        const next = { ...current };
        delete next[run.id];
        return next;
      });
    } catch (error) {
      setPlannerError(readErrorMessage(error, "Could not delete this planner render."));
    }
  }

  function openStopBlenderDialog(process: BlenderSession) {
    setPendingStopBlenderId(process.instanceId);
    setStopBlenderError(null);
  }

  function closeStopBlenderDialog() {
    if (stoppingBlenderId !== null) {
      return;
    }

    setPendingStopBlenderId(null);
    setStopBlenderError(null);
  }

  async function confirmStopRunningBlender() {
    if (!pendingStopBlenderId) {
      return;
    }

    setStoppingBlenderId(pendingStopBlenderId);
    setStopBlenderError(null);

    try {
      await stopRunningBlender(pendingStopBlenderId);
      setPendingStopBlenderId(null);
    } catch (error) {
      setStopBlenderError(readErrorMessage(error, "Could not stop Blender."));
    } finally {
      setStoppingBlenderId(null);
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

      await refreshManagedBlenderExtensions();

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

  useEffect(() => {
    if (blenderSessions.length > 0) {
      return;
    }

    setIsRunningBlenderTrayOpen(false);
    setPendingStopBlenderId(null);
    setStopBlenderError(null);
  }, [blenderSessions.length]);

  useEffect(() => {
    if (!activeLogsProcessId) {
      return;
    }

    if (blenderSessions.some((session) => session.instanceId === activeLogsProcessId)) {
      return;
    }

    setActiveLogsProcessId(null);
  }, [activeLogsProcessId, blenderSessions]);

  useEffect(() => {
    if (!activePlannerLogsRunId) {
      return;
    }

    if (plannerRuns.some((run) => run.id === activePlannerLogsRunId)) {
      return;
    }

    setActivePlannerLogsRunId(null);
  }, [activePlannerLogsRunId, plannerRuns]);

  useEffect(() => {
    if (!pendingStopBlenderId) {
      return;
    }

    if (runningBlenders.some((process) => process.instanceId === pendingStopBlenderId)) {
      return;
    }

    setPendingStopBlenderId(null);
    setStopBlenderError(null);
  }, [pendingStopBlenderId, runningBlenders]);

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
  const activeLogsProcess = blenderSessions.find((session) => session.instanceId === activeLogsProcessId) ?? null;
  const activePlannerLogsRun = plannerRuns.find((run) => run.id === activePlannerLogsRunId) ?? null;
  const pendingStopBlender = runningBlenders.find((process) => process.instanceId === pendingStopBlenderId) ?? null;

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
          <>
            {blenderSessions.length > 0 ? (
              <RunningBlenderTray
                processes={blenderSessions}
                isOpen={isRunningBlenderTrayOpen}
                onToggle={() => setIsRunningBlenderTrayOpen((current) => !current)}
                onOpenLogs={(process) => void openRunningBlenderLogs(process)}
                onStop={openStopBlenderDialog}
              />
            ) : null}
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
          </>
        }
      >
        {activePage === "home" ? (
          <HomePage
            recentProjects={recentProjects}
            favoriteVersions={favoriteInstalledVersions}
            errorMessage={homeError}
            onBrowseReleases={() => setActivePage("releases")}
            onOpenProject={(project) => void openRecentProject(project)}
            onRequestRemoveProject={openRemoveRecentProjectDialog}
            onLaunchVersion={(version) => void launchInstalledRelease(version)}
          />
        ) : activePage === "planner" ? (
          <PlannerPage
            blenderVersions={launcherState?.versions.filter((version) => version.available) ?? []}
            plannerRuns={plannerRuns}
            errorMessage={plannerError}
            submitErrorMessage={plannerCreateError}
            noticeMessage={plannerNotice}
            isLoading={isLoadingPlanner}
            isCreating={isCreatingPlannerRun}
            onCreateRun={schedulePlannerRun}
            onUpdateRun={(runId, payload) => updatePlannerRunById(runId, payload)}
            onBrowseBlendFile={browsePlannerBlendFile}
            onBrowseCustomBlender={browsePlannerBlenderExecutable}
            onBrowseOutputFolder={browsePlannerOutputFolder}
            onOpenLogs={(run) => void openPlannerLogs(run)}
            onDeleteRun={(run) => void deletePlannerRunById(run)}
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

      <BlenderLogsDialog
        open={activeLogsProcess !== null}
        process={activeLogsProcess}
        logs={activeLogsProcess?.logs ?? []}
        onClose={closeRunningBlenderLogs}
      />

      <PlannerLogsDialog
        open={activePlannerLogsRun !== null}
        run={activePlannerLogsRun}
        logs={activePlannerLogsRun ? plannerLogsByRunId[activePlannerLogsRun.id] ?? [] : []}
        onClose={closePlannerLogs}
      />

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
        confirmingLabel="Removing..."
        onConfirm={confirmRemoveBlenderConfig}
        onCancel={closeRemoveBlenderConfigDialog}
      />

      <ConfirmDialog
        open={pendingStopBlender !== null}
        title={pendingStopBlender ? `Stop ${pendingStopBlender.blenderVersion ? `Blender ${pendingStopBlender.blenderVersion}` : pendingStopBlender.blenderDisplayName}?` : "Stop Blender?"}
        description={
          pendingStopBlender ? (
            <>
              <p>This will terminate the running Blender session immediately.</p>
              <p>Unsaved work in that Blender window may be lost.</p>
            </>
          ) : (
            "This will stop the selected Blender session."
          )
        }
        errorMessage={stopBlenderError}
        confirmLabel="Stop Blender"
        confirmingLabel="Stopping..."
        cancelLabel="Keep it running"
        isConfirming={stoppingBlenderId !== null}
        onConfirm={confirmStopRunningBlender}
        onCancel={closeStopBlenderDialog}
      />

      <ConfirmDialog
        open={pendingRemoveRecentProject !== null}
        title={pendingRemoveRecentProject ? `Remove ${pendingRemoveRecentProject.name} from recent projects?` : "Remove recent project?"}
        description={
          pendingRemoveRecentProject ? (
            <>
              <p>This removes the missing project shortcut from your recent projects list.</p>
              <p>No files will be deleted from disk.</p>
            </>
          ) : (
            "This removes the selected recent project shortcut."
          )
        }
        errorMessage={removeRecentProjectError}
        confirmLabel="Remove recent project"
        confirmingLabel="Removing..."
        cancelLabel="Keep it"
        isConfirming={isRemovingRecentProject}
        onConfirm={confirmRemoveRecentProject}
        onCancel={closeRemoveRecentProjectDialog}
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
        confirmingLabel="Removing..."
        onConfirm={confirmUninstall}
        onCancel={closeUninstallDialog}
      />
    </>
  );
}










