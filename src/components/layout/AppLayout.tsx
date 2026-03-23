import type { PropsWithChildren, ReactNode } from "react";
import { AppMenu, type PageKey } from "./AppMenu";

interface AppLayoutProps extends PropsWithChildren {
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
  eyebrow: string;
  title: string;
  description: string;
  footer?: ReactNode;
}

export function AppLayout({ activePage, onNavigate, eyebrow, title, description, footer, children }: AppLayoutProps) {
  return (
    <main className="app-shell">
      <section className="home-frame">
        <header className="app-topbar">
          <div className="app-topbar-copy">
            <div className="app-brand" aria-label="Voxel Shift">
              <svg
                aria-hidden="true"
                className="app-brand-logo"
                viewBox="0 0 1080 1080"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g transform="translate(-1187)">
                  <g transform="matrix(1,0,0,0.992647,8,0)">
                    <g transform="matrix(0.834435,0,0,0.898057,521.34,85.542)">
                      <path d="M1031.43 40.481L1606 992L1955 29" stroke="currentColor" strokeWidth="143.81" />
                    </g>
                    <g transform="matrix(1,0,0,1.00741,-1182,0)">
                      <path d="M2454 617H2643" stroke="currentColor" strokeWidth="90.96" />
                    </g>
                    <g transform="matrix(1,0,0,1.00741,-1182,354.844)">
                      <path d="M2454 617H2842" stroke="currentColor" strokeWidth="90.83" />
                    </g>
                    <g transform="matrix(1,0,0,1.00741,-1184.5,181.333)">
                      <path d="M2454 617H2747.5" stroke="currentColor" strokeWidth="90.83" />
                    </g>
                  </g>
                </g>
              </svg>
            </div>
            {title ? <h1>{title}</h1> : null}
            {description ? <p className="page-description">{description}</p> : null}
            {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
          </div>

          <AppMenu activePage={activePage} onNavigate={onNavigate} />
        </header>

        <div className="page-content">{children}</div>
      </section>

      {footer ? (
        <div className="app-footer-shell">{footer}</div>
      ) : null}
    </main>
  );
}
