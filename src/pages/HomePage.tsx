import { ArrowRight, Sparkles } from "lucide-react";
import { favoriteVersions, recentProjects } from "../data/homeContent";

interface HomePageProps {
  favoriteCount: number;
  managedInstallCount: number;
}

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

export function HomePage({ favoriteCount, managedInstallCount }: HomePageProps) {
  return (
    <>
      <section className="overview-grid" aria-label="Workspace summary">
        <article className="overview-card">
          <p className="section-kicker">Recent Projects</p>
          <strong>{formatCount(recentProjects.length)}</strong>
          <p>Jump back into your current scenes from a dedicated page component instead of a monolithic app file.</p>
        </article>

        <article className="overview-card">
          <p className="section-kicker">Managed Installs</p>
          <strong>{formatCount(managedInstallCount)}</strong>
          <p>Versions installed inside the Voxel Shift managed library and ready for launch from the releases screen.</p>
        </article>

        <article className="overview-card overview-card-accent">
          <div className="overview-card-header">
            <p className="section-kicker">Release Favorites</p>
            <Sparkles size={18} strokeWidth={1.8} />
          </div>
          <strong>{formatCount(favoriteCount)}</strong>
          <p>Favorite release downloads are persisted locally, so the home layout can surface them later without extra rewiring.</p>
        </article>
      </section>

      <section className="shelf-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Recent Projects</p>
            <h3>Continue creating</h3>
          </div>
          <span className="section-badge">Page component</span>
        </div>

        <div className="carousel-track" aria-label="Recent projects">
          {recentProjects.map((project) => (
            <article className="project-card" key={project.id}>
              <div className={`project-thumb project-thumb-${project.accent}`}>
                <div className="thumb-shade" />
                <div className="project-meta">
                  <span className="thumb-label">{project.version}</span>
                  <div className="project-copy">
                    <h4>{project.name}</h4>
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
            <p className="section-kicker">Favorite Setups</p>
            <h3>Launch familiar environments</h3>
          </div>
          <span className="section-badge">{favoriteVersions.length} presets</span>
        </div>

        <div className="favorite-grid" aria-label="Favorite Blender versions">
          {favoriteVersions.map((version) => (
            <article className="favorite-card" key={version.id}>
              <div className="favorite-media">
                <span className="favorite-dot" />
                <span className="favorite-channel">{version.channel}</span>
              </div>
              <div className="favorite-body">
                <h4>{version.name}</h4>
                <p className="favorite-path">{version.path}</p>
              </div>
              <button className="card-action card-action-secondary card-action-inline" type="button">
                Launch
                <ArrowRight size={16} strokeWidth={1.8} />
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
