import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { isBlenderLtsVersion } from "../lib/blenderVersions";
import type { BlenderVersion, RecentProject } from "../types";

interface HomePageProps {
  recentProjects: RecentProject[];
  favoriteVersions: BlenderVersion[];
  errorMessage: string | null;
  onBrowseReleases: () => void;
  onOpenProject: (project: RecentProject) => void;
  onRequestRemoveProject: (project: RecentProject) => void;
  onLaunchVersion: (version: BlenderVersion) => void;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const pageSize = 5;

function parseSavedAt(value: string) {
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRelativeTime(value: string) {
  const date = parseSavedAt(value);
  if (!date) {
    return value;
  }

  const diffMs = date.getTime() - Date.now();
  const minutes = Math.round(diffMs / 60_000);

  if (Math.abs(minutes) < 60) {
    return relativeTimeFormatter.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relativeTimeFormatter.format(hours, "hour");
  }

  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) {
    return relativeTimeFormatter.format(days, "day");
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function formatBlenderLabel(project: RecentProject) {
  return project.blenderVersion ? `Blender ${project.blenderVersion}` : project.blenderDisplayName;
}

function getProjectThumbnailVersion(project: RecentProject) {
  return `${project.thumbnailPath ?? "none"}:${project.savedAt}`;
}

function getProjectThumbnailSrc(project: RecentProject) {
  if (!project.thumbnailPath) {
    return null;
  }

  const src = convertFileSrc(project.thumbnailPath);
  const cacheKey = encodeURIComponent(getProjectThumbnailVersion(project));
  return `${src}${src.includes("?") ? "&" : "?"}v=${cacheKey}`;
}

function getProjectMonogram(project: RecentProject) {
  const trimmed = project.name.trim();
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : "BL";
}

function getPageCount(length: number) {
  return Math.max(1, Math.ceil(length / pageSize));
}

interface CarouselControlsProps {
  label: string;
  page: number;
  pageCount: number;
  onPrevious: () => void;
  onNext: () => void;
}

function CarouselControls({ label, page, pageCount, onPrevious, onNext }: CarouselControlsProps) {
  if (pageCount <= 1) {
    return null;
  }

  return (
    <div className="home-carousel-controls" aria-label={`${label} navigation`}>
      <button
        className="home-carousel-button"
        type="button"
        onClick={onPrevious}
        disabled={page === 0}
        aria-label={`Show previous ${pageSize} ${label.toLowerCase()}`}
      >
        <ChevronLeft size={16} strokeWidth={2} />
      </button>
      <span className="home-carousel-count">
        {page + 1}/{pageCount}
      </span>
      <button
        className="home-carousel-button"
        type="button"
        onClick={onNext}
        disabled={page >= pageCount - 1}
        aria-label={`Show next ${pageSize} ${label.toLowerCase()}`}
      >
        <ChevronRight size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

export function HomePage({
  recentProjects,
  favoriteVersions,
  errorMessage,
  onBrowseReleases,
  onOpenProject,
  onRequestRemoveProject,
  onLaunchVersion,
}: HomePageProps) {
  const [failedThumbnailIds, setFailedThumbnailIds] = useState<Record<string, boolean>>({});
  const [recentPage, setRecentPage] = useState(0);
  const [favoritePage, setFavoritePage] = useState(0);

  const recentPageCount = getPageCount(recentProjects.length);
  const favoritePageCount = getPageCount(favoriteVersions.length);
  const showBrowseReleasesCta = recentProjects.length === 0 && favoriteVersions.length === 0;

  useEffect(() => {
    setRecentPage((current) => Math.min(current, recentPageCount - 1));
  }, [recentPageCount]);

  useEffect(() => {
    setFavoritePage((current) => Math.min(current, favoritePageCount - 1));
  }, [favoritePageCount]);

  const visibleRecentProjects = recentProjects.slice(recentPage * pageSize, recentPage * pageSize + pageSize);
  const visibleFavoriteVersions = favoriteVersions.slice(favoritePage * pageSize, favoritePage * pageSize + pageSize);

  if (showBrowseReleasesCta) {
    return (
      <>
        {errorMessage ? (
          <section className="release-state release-state-error">
            <h3>Could not refresh the home workspace</h3>
            <p>{errorMessage}</p>
          </section>
        ) : null}

        <section className="release-state">
          <h3>Start by adding a Blender release</h3>
          <p>Install or favorite a release to populate your home workspace with launch shortcuts and recent projects.</p>
          <div className="home-heading-actions">
            <button className="card-action" type="button" onClick={onBrowseReleases}>
              Browse releases
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {errorMessage ? (
        <section className="release-state release-state-error">
          <h3>Could not refresh the home workspace</h3>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      <section className="home-shelf">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Recent Projects</p>
            <h3>Continue where you left off</h3>
          </div>
          <div className="home-heading-actions">
            <span className="section-badge">{recentProjects.length} projects</span>
            <CarouselControls
              label="Recent projects"
              page={recentPage}
              pageCount={recentPageCount}
              onPrevious={() => setRecentPage((current) => Math.max(0, current - 1))}
              onNext={() => setRecentPage((current) => Math.min(recentPageCount - 1, current + 1))}
            />
          </div>
        </div>

        <div className="home-row-track home-row-track-recent" aria-label="Recent projects">
          {visibleRecentProjects.length > 0 ? (
            visibleRecentProjects.map((project) => {
              const thumbnailSrc = getProjectThumbnailSrc(project);
              const thumbnailVersion = getProjectThumbnailVersion(project);
              const showThumbnail = Boolean(thumbnailSrc) && !failedThumbnailIds[thumbnailVersion];

              return (
                <article className="home-card home-card-project" key={project.id}>
                  {!project.exists ? (
                    <div className="home-card-actions home-card-actions-overlay">
                      <button
                        className="home-card-icon-button home-card-icon-button-danger"
                        type="button"
                        onClick={() => onRequestRemoveProject(project)}
                        aria-label={`Remove ${project.name} from recent projects`}
                      >
                        <Trash2 size={16} strokeWidth={2} />
                      </button>
                    </div>
                  ) : null}
                  <button
                    className="home-card-button"
                    type="button"
                    onClick={() => onOpenProject(project)}
                    disabled={!project.exists}
                    aria-label={project.exists ? `Open ${project.name}` : `${project.name} is unavailable`}
                  >
                    {showThumbnail ? (
                      <img
                        key={thumbnailVersion}
                        className="home-project-thumbnail"
                        src={thumbnailSrc!}
                        alt={`${project.name} thumbnail`}
                        onError={() =>
                          setFailedThumbnailIds((current) =>
                            current[thumbnailVersion] ? current : { ...current, [thumbnailVersion]: true },
                          )
                        }
                      />
                    ) : (
                      <div className="home-project-thumbnail home-project-thumbnail-fallback" aria-hidden="true">
                        <span>{getProjectMonogram(project)}</span>
                      </div>
                    )}

                    <div className="home-card-copy home-card-copy-tight">
                      <div className="home-card-header home-card-header-tight">
                        <span className="home-card-badge">{formatBlenderLabel(project)}</span>
                        {!project.exists ? <span className="home-card-status home-card-status-missing">Missing</span> : null}
                      </div>
                      <h4 className="home-card-title">{project.name}</h4>
                      <p className="home-card-support">Saved {formatRelativeTime(project.savedAt)}</p>
                    </div>
                  </button>
                </article>
              );
            })
          ) : (
            <article className="home-card home-empty-card">
              <p className="home-card-eyebrow">Recent Projects</p>
              <h4 className="home-card-title">No saved projects yet</h4>
              <p className="home-card-support">Projects will appear here after they are saved from a Blender installed with Voxel Shift.</p>
            </article>
          )}
        </div>
      </section>

      <section className="home-shelf">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Favorite Versions</p>
            <h3>Launch your preferred Blender builds</h3>
          </div>
          <div className="home-heading-actions">
            <span className="section-badge">{favoriteVersions.length} favorites</span>
            <CarouselControls
              label="Favorite versions"
              page={favoritePage}
              pageCount={favoritePageCount}
              onPrevious={() => setFavoritePage((current) => Math.max(0, current - 1))}
              onNext={() => setFavoritePage((current) => Math.min(favoritePageCount - 1, current + 1))}
            />
          </div>
        </div>

        <div className="home-row-track home-row-track-favorites" aria-label="Favorite Blender versions">
          {visibleFavoriteVersions.length > 0 ? (
            visibleFavoriteVersions.map((version) => {
              const showLtsBadge = isBlenderLtsVersion(version.version);

              return (
                <article className="home-card home-card-version" key={version.id}>
                  <button
                    className="home-card-button"
                    type="button"
                    onClick={() => onLaunchVersion(version)}
                    disabled={!version.available}
                    aria-label={version.available ? `Launch ${version.displayName}` : `${version.displayName} is unavailable`}
                  >
                    <div className="home-card-copy home-card-copy-tight">
                      {version.isDefault ? (
                        <div className="home-card-header home-card-header-tight">
                          <div className="home-card-pill-row">
                            <span className="home-card-status">Default</span>
                          </div>
                        </div>
                      ) : null}
                      <h4 className="home-card-title">{version.displayName}</h4>
                      {showLtsBadge ? (
                        <div className="home-card-meta-row">
                          <span className="home-card-status home-card-status-lts">LTS</span>
                        </div>
                      ) : null}
                    </div>
                  </button>
                </article>
              );
            })
          ) : (
            <article className="home-card home-empty-card">
              <p className="home-card-eyebrow">Favorite Versions</p>
              <h4 className="home-card-title">No Blender versions are favorited yet</h4>
              <p className="home-card-support">Star an installed Blender build from the releases page and it will show up here.</p>
            </article>
          )}
        </div>
      </section>
    </>
  );
}
