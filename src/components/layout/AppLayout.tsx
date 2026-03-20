import type { PropsWithChildren } from "react";
import { AppMenu, type PageKey } from "./AppMenu";

interface AppLayoutProps extends PropsWithChildren {
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
  eyebrow: string;
  title: string;
  description: string;
}

export function AppLayout({ activePage, onNavigate, eyebrow, title, description, children }: AppLayoutProps) {
  return (
    <main className="app-shell">
      <section className="home-frame">
        <header className="app-topbar">
          <div className="app-topbar-copy">
            <p className="section-kicker">Voxel Shift</p>
            {title ? <h1>{title}</h1> : null}
            {description ? <p className="page-description">{description}</p> : null}
            <p className="page-eyebrow">{eyebrow}</p>
          </div>

          <AppMenu activePage={activePage} onNavigate={onNavigate} />
        </header>

        <div className="page-content">{children}</div>
      </section>
    </main>
  );
}
