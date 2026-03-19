import { invoke } from "@tauri-apps/api/core";
import type { BlenderReleaseListing, LauncherState } from "../types";

interface RegisterPayload {
  path: string;
  label?: string | null;
}

interface LaunchPayload {
  id: string;
  extraArgs?: string | null;
}

export function getLauncherState() {
  return invoke<LauncherState>("get_launcher_state");
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

export function openVersionLocation(id: string) {
  return invoke<void>("open_version_location", { id });
}

export function getBlenderReleaseDownloads() {
  return invoke<BlenderReleaseListing>("get_blender_release_downloads");
}
