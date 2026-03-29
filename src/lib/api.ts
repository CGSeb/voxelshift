import { invoke } from "@tauri-apps/api/core";
import type {
  BlenderConfigProfile,
  BlenderLogEntry,
  BlenderReleaseListing,
  LauncherState,
  RecentProject,
  RunningBlenderProcess,
} from "../types";

interface RegisterPayload {
  path: string;
  label?: string | null;
}

interface LaunchPayload {
  id: string;
  extraArgs?: string | null;
}

interface LaunchProjectPayload {
  id: string;
  projectPath: string;
}

interface InstallReleasePayload {
  id: string;
  version: string;
  fileName: string;
  url: string;
}

interface SaveBlenderConfigPayload {
  versionId: string;
  name: string;
}

interface ApplyBlenderConfigPayload {
  versionId: string;
  configId: string;
}

export function getLauncherState() {
  return invoke<LauncherState>("get_launcher_state");
}

export function getRecentProjects() {
  return invoke<RecentProject[]>("get_recent_projects");
}

export function refreshManagedBlenderExtensions() {
  return invoke<number>("refresh_managed_blender_extensions");
}

export function removeRecentProject(filePath: string) {
  return invoke<RecentProject[]>("remove_recent_project", { filePath });
}

export function scanForBlenderVersions() {
  return invoke<LauncherState>("scan_for_blender_versions");
}

export function registerBlenderVersion(payload: RegisterPayload) {
  return invoke<LauncherState>("register_blender_version", { request: payload });
}

export function setDefaultBlenderVersion(id: string) {
  return invoke<LauncherState>("set_default_blender_version", { id });
}

export function removeBlenderVersion(id: string) {
  return invoke<LauncherState>("remove_blender_version", { id });
}

export function addScanRoot(path: string) {
  return invoke<LauncherState>("add_scan_root", { path });
}

export function removeScanRoot(path: string) {
  return invoke<LauncherState>("remove_scan_root", { path });
}

export function launchBlender(payload: LaunchPayload) {
  return invoke<LauncherState>("launch_blender", { request: payload });
}

export function launchBlenderProject(payload: LaunchProjectPayload) {
  return invoke<LauncherState>("launch_blender_project", { request: payload });
}

export function getRunningBlenders() {
  return invoke<RunningBlenderProcess[]>("get_running_blenders");
}

export function getRunningBlenderLogs(instanceId: string) {
  return invoke<BlenderLogEntry[]>("get_running_blender_logs", { instanceId });
}

export function stopRunningBlender(instanceId: string) {
  return invoke<void>("stop_running_blender", { instanceId });
}

export function openVersionLocation(id: string) {
  return invoke<void>("open_version_location", { id });
}

export function getBlenderReleaseDownloads() {
  return invoke<BlenderReleaseListing>("get_blender_release_downloads");
}

export function installBlenderRelease(payload: InstallReleasePayload) {
  return invoke<LauncherState>("install_blender_release", { request: payload });
}

export function cancelBlenderReleaseInstall(id: string) {
  return invoke<void>("cancel_blender_release_install", { id });
}

export function getBlenderConfigs() {
  return invoke<BlenderConfigProfile[]>("get_blender_configs");
}

export function saveBlenderConfig(payload: SaveBlenderConfigPayload) {
  return invoke<BlenderConfigProfile>("save_blender_config", { request: payload });
}

export function applyBlenderConfig(payload: ApplyBlenderConfigPayload) {
  return invoke<void>("apply_blender_config", { request: payload });
}

export function removeBlenderConfig(configId: string) {
  return invoke<void>("remove_blender_config", { configId });
}


