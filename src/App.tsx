import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip } from "./components/Tooltip";
import { getBlenderReleaseDownloads } from "./lib/api";
import type { BlenderReleaseDownload, BlenderReleaseListing } from "./types";

const favoriteReleaseStorageKey = "voxelshift.favorite-release-downloads";

const recentProjects = [
  {
    id: "dust-lab",
    name: "Dust Lab",
    version: "Blender 4.2 LTS",
    updated: "Edited 2 hours ago",
    accent: "sand",
  },
  {
    id: "courtyard-study",
    name: "Courtyard Study",
    version: "Blender 3.6 LTS",
    updated: "Edited yesterday",
    accent: "teal",
  },
  {
    id: "relay-bike",
    name: "Relay Bike",
    version: "Blender 4.1",
    updated: "Edited 4 days ago",
    accent: "ember",
  },
];

const favoriteVersions = [
  {
    id: "blender-4-2",
    name: "Blender 4.2 LTS",
    channel: "Stable favorite",
    path: "Documents/VoxelShift/stable/blender-4.2",
  },
  {
    id: "blender-4-1",
    name: "Blender 4.1",
    channel: "Portable build",
    path: "Documents/VoxelShift/stable/blender-4.1",
  },
  {
    id: "blender-3-6",
    name: "Blender 3.6 LTS",
    channel: "Legacy project support",
    path: "Documents/VoxelShift/stable/blender-3.6",
  },
];

type PageKey = "home" | "releases";

function readFavoriteReleaseIds() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(favoriteReleaseStorageKey);
    if (!raw) {
      return [] as string[];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [] as string[];
  }
}

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [releaseListing, setReleaseListing] = useState<BlenderReleaseListing | null>(null);
  const [isLoadingReleases, setIsLoadingReleases] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [favoriteReleaseIds, setFavoriteReleaseIds] = useState<string[]>(() => readFavoriteReleaseIds());

  useEffect(() => {
    if (activePage !== "releases" || releaseListing) {
      return;
    }

    let cancelled = false;

    async function loadReleaseDownloads() {
      setIsLoadingReleases(true);
      setReleaseError(null);

      try {
        const listing = await getBlenderReleaseDownloads();

        if (!cancelled) {
          setReleaseListing(listing);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Could not load Blender release downloads.";
          setReleaseError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingReleases(false);
        }
      }
    }

    void loadReleaseDownloads();

    return () => {
      cancelled = true;
    };
  }, [activePage, releaseListing]);

  async function refreshReleaseDownloads() {
    setIsLoadingReleases(true);
    setReleaseError(null);

    try {
      const listing = await getBlenderReleaseDownloads();
      setReleaseListing(listing);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load Blender release downloads.";
      setReleaseError(message);
    } finally {
      setIsLoadingReleases(false);
    }
  }

  function toggleFavorite(download: BlenderReleaseDownload) {
    setFavoriteReleaseIds((current) => {
      const next = current.includes(download.id)
        ? current.filter((id) => id !== download.id)
        : [...current, download.id];

      window.localStorage.setItem(favoriteReleaseStorageKey, JSON.stringify(next));
      return next;
    });
  }

  const releaseDownloads = releaseListing?.downloads ?? [];

  return (
    <main className="app-shell">
      <section className="home-frame">
        <header className="app-topbar">
          <div>
            <p className="section-kicker">Voxel Shift</p>
          </div>

          <nav className="page-switcher" aria-label="Primary navigation">
            <button
              className={activePage === "home" ? "page-tab page-tab-active" : "page-tab"}
              type="button"
              onClick={() => setActivePage("home")}
            >
              Home
            </button>
            <button
              className={activePage === "releases" ? "page-tab page-tab-active" : "page-tab"}
              type="button"
              onClick={() => setActivePage("releases")}
            >
              Releases
            </button>
          </nav>
        </header>

        {activePage === "home" ? (
          <>
            <section className="shelf-panel shelf-panel-first">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Recent Projects</p>
                  <h2>Continue creating</h2>
                </div>
                <span className="section-badge">Home mockup</span>
              </div>

              <div className="carousel-track" aria-label="Recent projects">
                {recentProjects.map((project) => (
                  <article className="project-card" key={project.id}>
                    <div className={`project-thumb project-thumb-${project.accent}`}>
                      <div className="thumb-shade" />
                      <div className="project-meta">
                        <span className="thumb-label">{project.version}</span>
                        <div className="project-copy">
                          <h3>{project.name}</h3>
                          <p>{project.updated}</p>
                        </div>
                        <button className="card-action" type="button">
                          Open Project
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="shelf-panel">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Favorite Versions</p>
                  <h2>Launch favorites</h2>
                </div>
              </div>

              <div className="carousel-track carousel-track-compact" aria-label="Favorite Blender versions">
                {favoriteVersions.map((version) => (
                  <article className="favorite-card" key={version.id}>
                    <div className="favorite-media">
                      <span className="favorite-dot" />
                      <span className="favorite-channel">{version.channel}</span>
                    </div>
                    <div className="favorite-body">
                      <h3>{version.name}</h3>
                      <p className="favorite-path">{version.path}</p>
                    </div>
                    <button className="card-action card-action-secondary" type="button">
                      Launch
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="release-page shelf-panel-first">
            <section className="release-hero">
              <div>
                <p className="section-kicker">Official Release Downloads</p>
                <h2>Stable builds for {releaseListing?.platformLabel ?? "this platform"}</h2>

              </div>

              <div className="release-hero-actions">
                <span className="section-badge">{releaseDownloads.length} downloads found</span>
                <span className="section-badge">{favoriteReleaseIds.length} favorites</span>
                <button className="card-action card-action-secondary" type="button" onClick={() => void refreshReleaseDownloads()}>
                  {isLoadingReleases ? "Refreshing..." : "Refresh list"}
                </button>
              </div>
            </section>

            {releaseError ? (
              <section className="release-state release-state-error">
                <h3>Could not load the Blender download list</h3>
                <p>{releaseError}</p>
              </section>
            ) : isLoadingReleases && releaseDownloads.length === 0 ? (
              <section className="release-state">
                <h3>Loading release downloads</h3>
                <p>Scanning the official Blender release folders for platform-matching build files.</p>
              </section>
            ) : (
              <section className="release-list" aria-label="Stable Blender downloads">
                <div className="release-list-header release-row">
                  <span>Version</span>
                  <span>Channel</span>
                  <span>Release date</span>
                  <span className="release-actions-heading">Actions</span>
                </div>

                {releaseDownloads.map((download) => {
                  const isFavorite = favoriteReleaseIds.includes(download.id);

                  return (
                    <article className="release-row release-row-item" key={download.id}>
                      <div className="release-primary">
                        <strong>{download.version}</strong>
                      </div>
                      <div>
                        <span className="release-channel-chip">{download.channel}</span>
                      </div>
                      <div className="release-package">{download.releaseDate}</div>
                      <div className="release-actions">
                        <Tooltip content={isFavorite ? "Remove favorite" : "Mark as favorite"}>
                          <button
                            className={isFavorite ? "favorite-button favorite-button-active" : "favorite-button"}
                            type="button"
                            onClick={() => toggleFavorite(download)}
                            aria-pressed={isFavorite}
                            aria-label={isFavorite ? `Remove ${download.version} from favorites` : `Mark ${download.version} as favorite`}
                          >
                            <Star className="favorite-star" aria-hidden="true" fill={isFavorite ? "currentColor" : "none"} strokeWidth={2} />
                          </button>
                        </Tooltip>
                        <a className="card-action card-action-link" href={download.url} target="_blank" rel="noreferrer">
                          Install
                        </a>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </section>
        )}
      </section>
    </main>
  );
}














