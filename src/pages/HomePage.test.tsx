import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";
import type { BlenderVersion, RecentProject } from "../types";

const convertFileSrcMock = vi.hoisted(() => vi.fn((path: string) => `asset://${path}`));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: convertFileSrcMock,
}));

function makeProject(index: number, overrides: Partial<RecentProject> = {}): RecentProject {
  return {
    id: `project-${index}`,
    name: `Project ${index}`,
    filePath: `D:\\Projects\\project-${index}.blend`,
    thumbnailPath: index === 1 ? `D:\\Thumbs\\project-${index}.png` : null,
    blenderId: "blender-1",
    blenderDisplayName: "Blender nightly",
    blenderVersion: index % 2 === 0 ? "4.2.3" : null,
    savedAt: "not-a-date",
    exists: true,
    ...overrides,
  };
}

function makeVersion(index: number, overrides: Partial<BlenderVersion> = {}): BlenderVersion {
  return {
    id: `version-${index}`,
    displayName: `Blender ${index}`,
    version: index === 1 ? "4.2.3" : `4.${index}.0`,
    executablePath: `D:\\Blender ${index}\\blender.exe`,
    installDir: `D:\\VoxelShift\\stable\\Blender ${index}`,
    source: "manual",
    available: true,
    isDefault: index === 1,
    lastLaunchedAt: null,
    ...overrides,
  };
}

describe("HomePage", () => {
  beforeEach(() => {
    convertFileSrcMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the empty-state call to action when there are no projects or favorites", () => {
    const onBrowseReleases = vi.fn();

    render(
      <HomePage
        recentProjects={[]}
        favoriteVersions={[]}
        errorMessage="Could not load your workspace"
        onBrowseReleases={onBrowseReleases}
        onOpenProject={vi.fn()}
        onRequestRemoveProject={vi.fn()}
        onLaunchVersion={vi.fn()}
      />,
    );

    expect(screen.getByText("Could not load your workspace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse releases" }));
    expect(onBrowseReleases).toHaveBeenCalledTimes(1);
  });

  it("renders project and favorite carousels, thumbnail fallbacks, and launch actions", () => {
    const onOpenProject = vi.fn();
    const onRequestRemoveProject = vi.fn();
    const onLaunchVersion = vi.fn();
    const recentProjects = [
      makeProject(1),
      makeProject(2, { exists: false }),
      makeProject(3),
      makeProject(4),
      makeProject(5),
      makeProject(6),
    ];
    const favoriteVersions = [
      makeVersion(1),
      makeVersion(2, { available: false }),
      makeVersion(3),
      makeVersion(4),
      makeVersion(5),
      makeVersion(6),
    ];

    render(
      <HomePage
        recentProjects={recentProjects}
        favoriteVersions={favoriteVersions}
        errorMessage={null}
        onBrowseReleases={vi.fn()}
        onOpenProject={onOpenProject}
        onRequestRemoveProject={onRequestRemoveProject}
        onLaunchVersion={onLaunchVersion}
      />,
    );

    const thumbnail = screen.getByAltText("Project 1 thumbnail");
    expect(thumbnail).toHaveAttribute("src", expect.stringContaining("asset://D:\\Thumbs\\project-1.png"));
    fireEvent.error(thumbnail);
    expect(screen.getAllByText("PR").length).toBeGreaterThan(0);

    const missingProjectButton = screen.getByRole("button", { name: "Project 2 is unavailable" });
    expect(missingProjectButton).toBeDisabled();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Project 2 from recent projects" }));
    expect(onRequestRemoveProject).toHaveBeenCalledWith(expect.objectContaining({ id: "project-2" }));
    expect(screen.queryByRole("button", { name: "Remove Project 1 from recent projects" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Project 3" }));
    expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ id: "project-3" }));

    fireEvent.click(screen.getByRole("button", { name: "Show next 5 recent projects" }));
    expect(screen.getByRole("button", { name: "Open Project 6" })).toBeInTheDocument();
    const recentShelf = screen.getByLabelText("Recent projects");
    expect(within(recentShelf).getByText("Project 6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show previous 5 recent projects" }));
    expect(screen.getByRole("button", { name: "Open Project 1" })).toBeInTheDocument();

    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getAllByText("LTS").length).toBeGreaterThan(0);

    const unavailableVersionButton = screen.getByRole("button", { name: "Blender 2 is unavailable" });
    expect(unavailableVersionButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Show next 5 favorite versions" }));
    fireEvent.click(screen.getByRole("button", { name: "Launch Blender 6" }));
    fireEvent.click(screen.getByRole("button", { name: "Show previous 5 favorite versions" }));
    expect(onLaunchVersion).toHaveBeenCalledWith(expect.objectContaining({ id: "version-6" }));
  });

  it("formats valid recent project timestamps relative to the current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00"));

    render(
      <HomePage
        recentProjects={[
          makeProject(1, { savedAt: "2026-03-20 11:30:00" }),
          makeProject(2, { savedAt: "2026-03-20 08:00:00" }),
          makeProject(3, { savedAt: "2026-03-18 12:00:00" }),
          makeProject(4, { savedAt: "2025-12-31 12:00:00" }),
        ]}
        favoriteVersions={[]}
        errorMessage={null}
        onBrowseReleases={vi.fn()}
        onOpenProject={vi.fn()}
        onRequestRemoveProject={vi.fn()}
        onLaunchVersion={vi.fn()}
      />,
    );

    expect(screen.getByText("Saved 30 minutes ago")).toBeInTheDocument();
    expect(screen.getByText("Saved 4 hours ago")).toBeInTheDocument();
    expect(screen.getByText("Saved 2 days ago")).toBeInTheDocument();
    expect(
      screen.getByText(
        `Saved ${new Date("2025-12-31T12:00:00").toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`,
      ),
    ).toBeInTheDocument();
  });
});
