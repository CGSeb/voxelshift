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

export default function App() {
  return (
    <main className="app-shell">
      <section className="home-frame">
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
      </section>
    </main>
  );
}
