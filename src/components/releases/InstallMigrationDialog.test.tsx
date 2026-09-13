import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallMigrationDialog } from "./InstallMigrationDialog";
import type { BlenderVersion, InstallMigrationFolders } from "../../types";

const api = vi.hoisted(() => ({ getInstallMigrationFolders: vi.fn(), pickInstallMigrationFolder: vi.fn(), getInstallMigrationLinks: vi.fn() }));
vi.mock("../../lib/api", () => api);
const download = { id: "new", version: "5.0.0", fileName: "blender.zip", channel: "stable", releaseDate: "", url: "https://download.blender.org/blender.zip" };
const version: BlenderVersion = { id: "old", version: "4.5.0", displayName: "Blender 4.5", executablePath: "D:/old/blender.exe", installDir: "D:/old", source: "manual", available: true, isDefault: false, lastLaunchedAt: null };
const folders = { settingsPath: "D:/old/portable/config", extensionsPath: "D:/old/portable/extensions", addonsPath: "D:/old/portable/scripts/addons" };
const installedExtensions = [
  { name: "tool", linkPath: "portable/extensions/blender_org/tool", targetPath: "D:/old/portable/extensions/blender_org/tool" },
  { name: "custom", linkPath: "portable/extensions/user_default/custom", targetPath: "D:/old/portable/extensions/user_default/custom" },
];

describe("InstallMigrationDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getInstallMigrationFolders.mockResolvedValue(folders);
    api.getInstallMigrationLinks.mockResolvedValue(installedExtensions);
  });

  it("traps keyboard focus, isolates dropdown Escape, and restores the opener on unmount", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const previousOverflow = document.body.style.overflow;
    const onClose = vi.fn();
    const { unmount } = render(<InstallMigrationDialog download={download} versions={[version]} onInstall={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "Previous version" });
    const last = screen.getByRole("button", { name: "Install with selected setup" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.click(first);
    fireEvent.keyDown(screen.getByRole("option"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.body.style.overflow).toBe(previousOverflow);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("locks dismissal while browsing and preserves the source when the picker is canceled", async () => {
    let resolvePicker!: (value: string | null) => void;
    api.pickInstallMigrationFolder.mockReturnValue(new Promise((resolve) => { resolvePicker = resolve; }));
    const onClose = vi.fn();
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    fireEvent.click(screen.getByRole("button", { name: "Symlink tool" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse tool folder" }));
    expect(screen.getByRole("button", { name: "Previous version" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Install fresh" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolvePicker(null));
    expect(screen.getByLabelText("tool")).toHaveValue(installedExtensions[0].targetPath);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Hide advanced options" }));
    expect(screen.queryByLabelText("tool")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports folder picker failures and allows retrying", async () => {
    api.pickInstallMigrationFolder.mockRejectedValueOnce("Folder picker unavailable").mockResolvedValueOnce("D:/retry/tool");
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    fireEvent.click(screen.getByRole("button", { name: "Symlink tool" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse tool folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Folder picker unavailable");
    expect(screen.getByLabelText("tool")).toHaveValue(installedExtensions[0].targetPath);
    fireEvent.click(screen.getByRole("button", { name: "Browse tool folder" }));
    await waitFor(() => expect(screen.getByLabelText("tool")).toHaveValue("D:/retry/tool"));
  });

  it("does not let a stale extension listing replace the newly selected version", async () => {
    let resolveLinks!: (value: typeof installedExtensions) => void;
    api.getInstallMigrationLinks.mockReturnValueOnce(new Promise((resolve) => { resolveLinks = resolve; })).mockResolvedValueOnce([]);
    const other = { ...version, id: "other", version: "4.4.0" };
    render(<InstallMigrationDialog download={download} versions={[version, other]} onInstall={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(api.getInstallMigrationLinks).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Previous version" }));
    fireEvent.click(screen.getByRole("option", { name: "4.4.0" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    await act(async () => resolveLinks(installedExtensions));
    expect(screen.getByText("No extensions found in the selected previous version.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Symlink tool" })).not.toBeInTheDocument();
  });

  it("ignores stale discovery errors after a previous version switch", async () => {
    let rejectFolders!: (reason: string) => void;
    api.getInstallMigrationFolders.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFolders = reject; }));
    const other = { ...version, id: "other", version: "4.4.0" };
    render(<InstallMigrationDialog download={download} versions={[version, other]} onInstall={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous version" }));
    fireEvent.click(screen.getByRole("option", { name: "4.4.0" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    await act(async () => rejectFolders("Old source missing"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled();
  });

  it("copies available settings without querying missing extension folders", async () => {
    api.getInstallMigrationFolders.mockResolvedValue({ settingsPath: folders.settingsPath, extensionsPath: null, addonsPath: null });
    const onInstall = vi.fn();
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={onInstall} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    expect(api.getInstallMigrationLinks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenCalledWith({ settingsPath: folders.settingsPath, extensionsPath: null, addonsPath: null, extensionMode: "copy" });
  });

  it("always copies settings and legacy add-ons even when extensions are disabled", async () => {
    const onInstall = vi.fn();
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={onInstall} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Copy settings")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Transfer extensions"));
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenCalledWith({ ...folders, extensionsPath: null, extensionMode: "copy" });
  });

  it("shows one folder per installed extension and submits only the edited override", async () => {
    const onInstall = vi.fn();
    api.pickInstallMigrationFolder.mockResolvedValue("D:/Shared/tool");
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={onInstall} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    expect(screen.queryByLabelText("Settings folder")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Legacy add-ons folder")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Symlink" }));
    expect(screen.queryByLabelText("Extensions folder")).not.toBeInTheDocument();
    expect(screen.getByLabelText("tool")).toHaveValue(installedExtensions[0].targetPath);
    expect(screen.getByLabelText("custom")).toHaveValue(installedExtensions[1].targetPath);
    fireEvent.click(screen.getByRole("button", { name: "Browse tool folder" }));
    await waitFor(() => expect(screen.getByLabelText("tool")).toHaveValue("D:/Shared/tool"));
    expect(screen.getByText(/Keep the source folders available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenCalledWith({ ...folders, extensionMode: "symlink", extensionOverrides: [{ linkPath: installedExtensions[0].linkPath, targetPath: "D:/Shared/tool", mode: "symlink" }] });
  });

  it("can install fresh after a detection error and cancel without installing", async () => {
    api.getInstallMigrationFolders.mockRejectedValue("Previous installation unavailable");
    const onInstall = vi.fn();
    const onClose = vi.fn();
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={onInstall} onClose={onClose} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Previous installation unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onInstall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Install fresh" }));
    expect(onInstall).toHaveBeenCalledWith();
  });

  it("ignores stale folder detection when the source changes", async () => {
    const onInstall = vi.fn();
    let resolveOld!: (value: InstallMigrationFolders) => void;
    api.getInstallMigrationFolders.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const otherFolders = { ...folders, extensionsPath: "D:/other/portable/extensions" };
    api.getInstallMigrationFolders.mockResolvedValueOnce(otherFolders);
    const otherVersion = { ...version, id: "other", version: "4.4.0", displayName: "Blender 4.4" };
    render(<InstallMigrationDialog download={download} versions={[version, otherVersion]} onInstall={onInstall} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous version" }));
    fireEvent.click(screen.getByRole("option", { name: "4.4.0" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    await act(async () => resolveOld(folders));
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenCalledWith({ ...otherFolders, extensionMode: "copy" });
  });

  it("hides the shared source and uses it automatically in copy mode", async () => {
    const onInstall = vi.fn();
    api.getInstallMigrationLinks.mockResolvedValue([{ name: "tool", linkPath: "portable/extensions/blender_org/tool", targetPath: "D:/shared/tool" }]);
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={onInstall} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    expect(screen.queryByRole("group", { name: "Extension transfer method" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    expect(screen.queryByRole("button", { name: "Show extension symlinks" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Extensions source folder")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("tool")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Browse extensions source folder" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Symlink" }));
    expect(screen.queryByLabelText("Extensions source folder")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Symlink" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("list", { name: "Extension symlink locations" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("tool")).toHaveValue("D:/shared/tool");
    fireEvent.change(screen.getByLabelText("tool"), { target: { value: "D:/updated/tool" } });
    expect(screen.getByLabelText("tool")).toHaveValue("D:/updated/tool");
    expect(api.getInstallMigrationLinks).toHaveBeenCalledWith(folders.extensionsPath);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.queryByLabelText("tool")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Extensions source folder")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenCalledWith({ ...folders, extensionMode: "copy" });
    expect(screen.queryByRole("list", { name: "Extension symlink locations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show extension symlinks" })).not.toBeInTheDocument();
  });

  it("resets extension overrides when switching previous versions", async () => {
    const onInstall = vi.fn();
    const other = { ...version, id: "other", version: "4.4.0" };
    render(<InstallMigrationDialog download={download} versions={[version, other]} onInstall={onInstall} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    fireEvent.click(screen.getByRole("button", { name: "Symlink" }));
    fireEvent.change(screen.getByLabelText("tool"), { target: { value: "D:/changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy custom" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous version" }));
    fireEvent.click(screen.getByRole("option", { name: "4.4.0" }));
    await waitFor(() => expect(screen.getByLabelText("tool")).toHaveValue(installedExtensions[0].targetPath));
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenCalledWith({ ...folders, extensionMode: "symlink" });
  });

  it("keeps fresh install available when there is no previous version", () => {
    render(<InstallMigrationDialog download={download} versions={[]} onInstall={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    expect(screen.queryByLabelText("Extensions source folder")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Symlink" }));
    expect(screen.getByText("No extensions found in the selected previous version.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install fresh" })).toBeEnabled();
  });

  it("mixes copied and linked extensions and only validates linked source folders", async () => {
    const onInstall = vi.fn();
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={onInstall} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    expect(screen.getByRole("button", { name: "Copy tool" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Symlink tool" }));
    expect(screen.queryByLabelText("custom")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("tool"), { target: { value: "D:/shared/tool" } });
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenLastCalledWith({ ...folders, extensionMode: "copy", extensionOverrides: [
      { linkPath: installedExtensions[0].linkPath, targetPath: "D:/shared/tool", mode: "symlink" },
    ] });
    fireEvent.change(screen.getByLabelText("tool"), { target: { value: " " } });
    expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Copy tool" }));
    expect(screen.queryByLabelText("tool")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenLastCalledWith({ ...folders, extensionMode: "copy" });
  });

  it("uses the previous source when an individual extension switches back to copy", async () => {
    const onInstall = vi.fn();
    render(<InstallMigrationDialog download={download} versions={[version]} onInstall={onInstall} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install with selected setup" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Advanced: choose folders" }));
    fireEvent.click(screen.getByRole("button", { name: "Symlink" }));
    fireEvent.change(screen.getByLabelText("tool"), { target: { value: "D:/shared/tool" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy tool" }));
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenLastCalledWith({ ...folders, extensionMode: "symlink", extensionOverrides: [
      { linkPath: installedExtensions[0].linkPath, targetPath: installedExtensions[0].targetPath, mode: "copy" },
    ] });
    fireEvent.click(screen.getByRole("button", { name: "Symlink" }));
    expect(screen.getByRole("button", { name: "Symlink tool" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("Transfer extensions"));
    fireEvent.click(screen.getByRole("button", { name: "Install with selected setup" }));
    expect(onInstall).toHaveBeenLastCalledWith({ ...folders, extensionsPath: null, extensionMode: "symlink" });
  });
});
