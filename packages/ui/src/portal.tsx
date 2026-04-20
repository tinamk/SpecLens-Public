import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export type PortalNavItem = {
  key: string;
  href: string;
  label: string;
  testId?: string;
};

export function PortalShell({
  title,
  eyebrow,
  lede = "Hosted workspaces, queued runs, live logs, and parity reports all stay reviewable here.",
  pageTestId,
  primaryNav = [],
  activePrimaryNavKey,
  secondaryNav = [],
  activeSecondaryNavKey,
  children,
}: {
  title: string;
  eyebrow: string;
  lede?: string;
  pageTestId?: string;
  primaryNav?: PortalNavItem[];
  activePrimaryNavKey?: string;
  secondaryNav?: PortalNavItem[];
  activeSecondaryNavKey?: string;
  children: ReactNode;
}) {
  return (
    <main className="portal-shell" data-testid={pageTestId}>
      <header className="portal-shell__chrome">
        <div className="portal-shell__chrome-inner">
          <div className="portal-shell__brand-row">
            <Link className="portal-shell__brand" href="/">
              <span className="logo-mark">SL</span>
              <span>
                <span className="brand-kicker">Hosted control plane</span>
                <strong className="brand-name">SpecLens portal</strong>
              </span>
            </Link>
            {primaryNav.length > 0 ? (
              <nav aria-label="Portal navigation" className="portal-shell__nav">
                {primaryNav.map(item => (
                  <Link
                    className={item.key === activePrimaryNavKey ? "portal-shell__nav-link portal-shell__nav-link--active" : "portal-shell__nav-link"}
                    data-testid={item.testId ?? `portal-nav-${item.key}`}
                    href={item.href as Route}
                    key={item.key}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
          <div className="portal-shell__actions">
            <Link className="button-ghost" href="/">Marketing site</Link>
            <a className="button-secondary" href="/api/auth/logout">Log out</a>
          </div>
        </div>
      </header>
      <section className="portal-shell__intro">
        <div className="portal-shell__intro-card">
          <div className="portal-shell__title-row">
            <div>
              <p className="portal-shell__eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
            </div>
            <p className="portal-shell__lede">
              {lede}
            </p>
          </div>
          {secondaryNav.length > 0 ? (
            <nav aria-label="Section navigation" className="portal-shell__subnav">
              {secondaryNav.map(item => (
                  <Link
                    className={item.key === activeSecondaryNavKey ? "portal-shell__subnav-link portal-shell__subnav-link--active" : "portal-shell__subnav-link"}
                    data-testid={item.testId ?? `portal-subnav-${item.key}`}
                    href={item.href as Route}
                    key={item.key}
                  >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </section>
      <div className="portal-shell__content">{children}</div>
    </main>
  );
}
