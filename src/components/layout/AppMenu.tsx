export type PageKey = "home" | "releases";

interface AppMenuProps {
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
}

export function AppMenu({ activePage, onNavigate }: AppMenuProps) {
  return (
    <nav className="page-switcher" aria-label="Primary navigation">
      <button
        className={activePage === "home" ? "page-tab page-tab-active" : "page-tab"}
        type="button"
        onClick={() => onNavigate("home")}
      >
        Home
      </button>
      <button
        className={activePage === "releases" ? "page-tab page-tab-active" : "page-tab"}
        type="button"
        onClick={() => onNavigate("releases")}
      >
        Releases
      </button>
    </nav>
  );
}
