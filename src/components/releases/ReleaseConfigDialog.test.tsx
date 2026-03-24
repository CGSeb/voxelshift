import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReleaseConfigDialog } from "./ReleaseConfigDialog";
import type { BlenderConfigProfile, BlenderVersion } from "../../types";

const version: BlenderVersion = {
  id: "version-42",
  displayName: "Blender 4.2.3",
  version: "4.2.3",
  executablePath: "D:\\Blender\\blender.exe",
  installDir: "D:\\VoxelShift\\stable\\Blender 4.2.3",
  source: "manual",
  available: true,
  isDefault: false,
  lastLaunchedAt: null,
};

const config: BlenderConfigProfile = {
  id: "Studio",
  name: "Studio",
  path: "D:\\Users\\Sebastien\\Documents\\VoxelShift\\configs\\Studio",
  updatedAt: 1,
};

describe("ReleaseConfigDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ReleaseConfigDialog
        open={false}
        mode="save"
        version={version}
        configs={[]}
        configName="4.2.3"
        isLoading={false}
        isSaving={false}
        applyingConfigId={null}
        deletingConfigId={null}
        onConfigNameChange={vi.fn()}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onRequestRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the save flow and closes when idle", () => {
    const onConfigNameChange = vi.fn();
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <ReleaseConfigDialog
        open
        mode="save"
        version={version}
        configs={[config]}
        configName="4.2.3"
        isLoading={false}
        isSaving={false}
        applyingConfigId={null}
        deletingConfigId={null}
        noticeMessage="Saved 4.2.3."
        onConfigNameChange={onConfigNameChange}
        onSave={onSave}
        onApply={vi.fn()}
        onRequestRemove={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Saved 4.2.3.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save current config" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Config name"), { target: { value: "Studio" } });
    fireEvent.click(screen.getByRole("button", { name: "Save current config" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onConfigNameChange).toHaveBeenCalledWith("Studio");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the apply flow and lets you apply or remove a config", () => {
    const onApply = vi.fn();
    const onRequestRemove = vi.fn();

    render(
      <ReleaseConfigDialog
        open
        mode="apply"
        version={version}
        configs={[config]}
        configName="4.2.3"
        isLoading={false}
        isSaving={false}
        applyingConfigId={null}
        deletingConfigId={null}
        onConfigNameChange={vi.fn()}
        onSave={vi.fn()}
        onApply={onApply}
        onRequestRemove={onRequestRemove}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save current config" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onApply).toHaveBeenCalledWith(config);
    expect(onRequestRemove).toHaveBeenCalledWith(config);
  });

  it("locks the apply flow while deleting", () => {
    const onClose = vi.fn();

    render(
      <ReleaseConfigDialog
        open
        mode="apply"
        version={version}
        configs={[config]}
        configName="4.2.3"
        isLoading={false}
        isSaving={false}
        applyingConfigId={null}
        deletingConfigId={config.id}
        onConfigNameChange={vi.fn()}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onRequestRemove={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Removing..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
  });
});
