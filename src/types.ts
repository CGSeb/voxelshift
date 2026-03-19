export type VersionSource = "discovered" | "manual";

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
