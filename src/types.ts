export type VersionSource = "discovered" | "manual";
export type ReleaseInstallPhase = "starting" | "downloading" | "extracting" | "canceling" | "completed" | "failed" | "canceled";

export interface BlenderVersion {
  id: string;
  displayName: string;
  version: string | null;
  executablePath: string;
  installDir: string;
  source: VersionSource;
  available: boolean;
  isDefault: boolean;
  lastLaunchedAt: number | null;
}

export interface LauncherState {
  versions: BlenderVersion[];
  scanRoots: string[];
  detectedAt: number;
}

export interface RecentProject {
  id: string;
  name: string;
  filePath: string;
  thumbnailPath: string | null;
  blenderId: string;
  blenderDisplayName: string;
  blenderVersion: string | null;
  savedAt: string;
  exists: boolean;
}

export interface BlenderReleaseDownload {
  id: string;
  channel: string;
  version: string;
  fileName: string;
  releaseDate: string;
  url: string;
}

export interface BlenderExperimentalReleaseGroup {
  platformKey: string;
  platformLabel: string;
  downloads: BlenderReleaseDownload[];
}

export interface BlenderReleaseListing {
  platformLabel: string;
  stableDownloads: BlenderReleaseDownload[];
  experimentalGroups: BlenderExperimentalReleaseGroup[];
  experimentalError: string | null;
}

export interface BlenderReleaseInstallProgress {
  releaseId: string;
  phase: ReleaseInstallPhase;
  progressPercent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBytesPerSecond: number | null;
  installDir: string | null;
  message: string;
}

export interface BlenderConfigProfile {
  id: string;
  name: string;
  path: string;
  updatedAt: number;
}

export type BlenderLogSource = "stdout" | "stderr" | "system";

export interface RunningBlenderProcess {
  instanceId: string;
  blenderId: string;
  blenderDisplayName: string;
  blenderVersion: string | null;
  pid: number;
  startedAt: number;
  projectPath: string | null;
  isStopping: boolean;
}

export interface BlenderLogEntry {
  id: string;
  instanceId: string;
  source: BlenderLogSource;
  message: string;
  timestamp: number;
}

export interface BlenderLogEvent {
  instanceId: string;
  entry: BlenderLogEntry;
}

export interface BlenderSession extends RunningBlenderProcess {
  isRunning: boolean;
  closedAt: number | null;
  logs: BlenderLogEntry[];
}

export type PlannerRunStatus = "pending" | "running" | "completed" | "failed";
export type PlannerBlenderSource = "library" | "custom";

export interface PlannerBlenderTarget {
  source: PlannerBlenderSource;
  versionId: string | null;
  displayName: string;
  executablePath: string;
}

export interface PlannerRunSummary {
  id: string;
  blendFilePath: string;
  startFrame: number;
  endFrame: number;
  startAt: number;
  outputFolderPath?: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  status: PlannerRunStatus;
  blenderTarget: PlannerBlenderTarget;
  currentFrame: number | null;
  renderedFrameCount: number;
  averageRenderTimeSeconds: number | null;
  estimatedRemainingSeconds: number | null;
  pid: number | null;
  lastErrorMessage: string | null;
  exitCode: number | null;
}

export interface PlannerLogEntry {
  id: string;
  runId: string;
  source: BlenderLogSource;
  message: string;
  timestamp: number;
}

export interface PlannerLogEvent {
  runId: string;
  entry: PlannerLogEntry;
}

