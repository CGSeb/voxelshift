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
