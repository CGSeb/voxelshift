import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppUpdateToast } from "./AppUpdateToast";

const updateInfo = {
  currentVersion: "1.0.0",
  version: "1.1.0",
  date: "2026-03-20",
  body: "Fresh fixes and polish.",
  rawJson: {},
};

describe("AppUpdateToast", () => {
  it("renders available updates with actions and release notes", () => {
    const onInstallUpdate = vi.fn();
    const onClose = vi.fn();

    render(
      <AppUpdateToast
        phase="available"
        updateInfo={updateInfo}
        errorMessage={null}
        progressPercent={null}
        downloadedBytes={0}
        totalBytes={null}
        actionLabel="Update now"
        canDismiss
        onInstallUpdate={onInstallUpdate}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Voxel Shift 1.1.0 is ready")).toBeInTheDocument();
    expect(screen.getByText(/v1.0.0 -> v1.1.0/)).toBeInTheDocument();
    expect(screen.getByText("Fresh fixes and polish.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(onInstallUpdate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows progress details while downloading and locks dismissal during install", () => {
    render(
      <AppUpdateToast
        phase="downloading"
        updateInfo={updateInfo}
        errorMessage={null}
        progressPercent={25}
        downloadedBytes={256}
        totalBytes={1024}
        actionLabel={null}
        canDismiss={false}
        onInstallUpdate={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Downloading Voxel Shift 1.1.0")).toBeInTheDocument();
    expect(screen.getByText("256 B of 1.00 KB downloaded.")).toBeInTheDocument();
    expect(screen.getByText("25% downloaded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss update toast" })).not.toBeInTheDocument();
  });

  it("renders installing progress with invalid dates and zero-byte totals", () => {
    render(
      <AppUpdateToast
        phase="installing"
        updateInfo={{ ...updateInfo, date: "not-a-date" }}
        errorMessage={null}
        progressPercent={null}
        downloadedBytes={0}
        totalBytes={null}
        actionLabel={null}
        canDismiss={false}
        onInstallUpdate={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/not-a-date/)).toBeInTheDocument();
    expect(screen.getByText("Applying the downloaded update package.")).toBeInTheDocument();
    expect(screen.getByText("0 B")).toBeInTheDocument();
  });

  it("renders generic fallback copy when no update metadata is available", () => {
    const onClose = vi.fn();

    render(
      <AppUpdateToast
        phase="idle"
        updateInfo={null}
        errorMessage={null}
        progressPercent={null}
        downloadedBytes={0}
        totalBytes={null}
        actionLabel={null}
        canDismiss
        onInstallUpdate={null}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("heading", { name: "Voxel Shift update" })).toBeInTheDocument();
    expect(screen.getByText("A new update is ready to install.")).toBeInTheDocument();
    expect(screen.queryByText(/v1\.0\.0/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss update toast" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders failure and completed states with the correct messaging", () => {
    const { rerender } = render(
      <AppUpdateToast
        phase="failed"
        updateInfo={updateInfo}
        errorMessage="Could not install the update."
        progressPercent={null}
        downloadedBytes={0}
        totalBytes={null}
        actionLabel="Retry update"
        canDismiss
        onInstallUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Could not install the update.")).toBeInTheDocument();

    rerender(
      <AppUpdateToast
        phase="completed"
        updateInfo={updateInfo}
        errorMessage={null}
        progressPercent={null}
        downloadedBytes={1024}
        totalBytes={1024}
        actionLabel={null}
        canDismiss
        onInstallUpdate={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Voxel Shift 1.1.0 installed")).toBeInTheDocument();
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.getByText("Update package applied")).toBeInTheDocument();
  });
});
