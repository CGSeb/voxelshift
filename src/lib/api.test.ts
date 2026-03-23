import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  addScanRoot,
  cancelBlenderReleaseInstall,
  getBlenderReleaseDownloads,
  getLauncherState,
  getRecentProjects,
  installBlenderRelease,
  launchBlender,
  launchBlenderProject,
  openVersionLocation,
  registerBlenderVersion,
  removeBlenderVersion,
  removeScanRoot,
  scanForBlenderVersions,
  setDefaultBlenderVersion,
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
    await openVersionLocation("version-1");
    await getBlenderReleaseDownloads();
    await installBlenderRelease(installPayload);
    await cancelBlenderReleaseInstall("release-1");

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
      ["open_version_location", { id: "version-1" }],
      ["get_blender_release_downloads"],
      ["install_blender_release", { request: installPayload }],
      ["cancel_blender_release_install", { id: "release-1" }],
    ]);
  });
});
