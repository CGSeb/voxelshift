import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  addScanRoot,
  applyBlenderConfig,
  cancelBlenderReleaseInstall,
  getBlenderConfigs,
  getBlenderReleaseDownloads,
  getLauncherState,
  getRecentProjects,
  getRunningBlenderLogs,
  getRunningBlenders,
  installBlenderRelease,
  launchBlender,
  launchBlenderProject,
  openVersionLocation,
  registerBlenderVersion,
  removeBlenderConfig,
  removeBlenderVersion,
  removeScanRoot,
  saveBlenderConfig,
  scanForBlenderVersions,
  setDefaultBlenderVersion,
  stopRunningBlender,
} from "./api";

describe("api wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("calls invoke with the expected command names and payloads", async () => {
    const launchPayload = { id: "version-1", extraArgs: "--factory-startup" };
    const projectPayload = { id: "version-1", projectPath: "D:\\scene.blend" };
    const installPayload = {
      id: "release-1",
      version: "4.2.3",
      fileName: "blender-4.2.3-windows-x64.zip",
      url: "https://download.blender.org/release/Blender4.2/blender-4.2.3-windows-x64.zip",
    };
    const saveConfigPayload = { versionId: "version-1", name: "4.2.3" };
    const applyConfigPayload = { versionId: "version-1", configId: "Studio" };

    await getLauncherState();
    await getRecentProjects();
    await scanForBlenderVersions();
    await registerBlenderVersion({ path: "D:\\Blender\\blender.exe", label: "Stable" });
    await setDefaultBlenderVersion("version-1");
    await removeBlenderVersion("version-1");
    await addScanRoot("D:\\Blender");
    await removeScanRoot("D:\\Blender");
    await launchBlender(launchPayload);
    await launchBlenderProject(projectPayload);
    await getRunningBlenders();
    await getRunningBlenderLogs("instance-1");
    await stopRunningBlender("instance-1");
    await openVersionLocation("version-1");
    await getBlenderReleaseDownloads();
    await installBlenderRelease(installPayload);
    await cancelBlenderReleaseInstall("release-1");
    await getBlenderConfigs();
    await saveBlenderConfig(saveConfigPayload);
    await applyBlenderConfig(applyConfigPayload);
    await removeBlenderConfig("Studio");

    expect(invokeMock.mock.calls).toEqual([
      ["get_launcher_state"],
      ["get_recent_projects"],
      ["scan_for_blender_versions"],
      ["register_blender_version", { request: { path: "D:\\Blender\\blender.exe", label: "Stable" } }],
      ["set_default_blender_version", { id: "version-1" }],
      ["remove_blender_version", { id: "version-1" }],
      ["add_scan_root", { path: "D:\\Blender" }],
      ["remove_scan_root", { path: "D:\\Blender" }],
      ["launch_blender", { request: launchPayload }],
      ["launch_blender_project", { request: projectPayload }],
      ["get_running_blenders"],
      ["get_running_blender_logs", { instanceId: "instance-1" }],
      ["stop_running_blender", { instanceId: "instance-1" }],
      ["open_version_location", { id: "version-1" }],
      ["get_blender_release_downloads"],
      ["install_blender_release", { request: installPayload }],
      ["cancel_blender_release_install", { id: "release-1" }],
      ["get_blender_configs"],
      ["save_blender_config", { request: saveConfigPayload }],
      ["apply_blender_config", { request: applyConfigPayload }],
      ["remove_blender_config", { configId: "Studio" }],
    ]);
  });
});
