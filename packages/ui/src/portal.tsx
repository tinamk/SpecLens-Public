import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeSwitcher } from "./theme-switcher";

export type PortalNavItem = {
  key: string;
  href: string;
  label: string;
  testId?: string;
};

export type PortalMetaItem = {
  label: string;
  value: ReactNode;
};

export function PortalLinkGrid({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return <div className="portal-link-grid" data-testid={testId}>{children}</div>;
}

export function PortalLinkCard({
  href,
  title,
  description,
  eyebrow,
  active = false,
  tone = "neutral",
  testId,
}: {
  href: string;
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  active?: boolean;
  tone?: "neutral" | "info" | "success" | "warning";
  testId?: string;
}) {
  const toneClassName = tone === "info"
    ? "portal-link-card--info"
    : tone === "success"
      ? "portal-link-card--success"
      : tone === "warning"
        ? "portal-link-card--warning"
        : "";
  const activeClassName = active ? "portal-link-card--active" : "";
  const className = ["portal-link-card", toneClassName, activeClassName].filter(Boolean).join(" ");

  return (
    <Link className={className} data-testid={testId} href={href as Route}>
      {eyebrow ? <span className="portal-link-card__eyebrow">{eyebrow}</span> : null}
      <strong className="portal-link-card__title">{title}</strong>
      {description ? <span className="portal-link-card__description">{description}</span> : null}
    </Link>
  );
}

export function PortalSectionHeader({
  badgeLabel,
  badgeClassName = "tag tag--neutral",
  title,
  description,
  actions,
  testId,
}: {
  badgeLabel?: ReactNode;
  badgeClassName?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="portal-section-heading" data-testid={testId}>
      <div className="portal-section-heading__copy">
        {badgeLabel ? <span className={badgeClassName}>{badgeLabel}</span> : null}
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="portal-section-heading__actions">{actions}</div> : null}
    </div>
  );
}

export function PortalNoticePanel({
  badgeLabel = "Restricted",
  badgeClassName = "tag tag--warning",
  title,
  description,
  actions,
  testId,
  descriptionTestId,
}: {
  badgeLabel?: ReactNode;
  badgeClassName?: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  testId?: string;
  descriptionTestId?: string;
}) {
  return (
    <section className="portal-panel portal-notice-panel" data-testid={testId}>
      <div className="portal-notice-panel__copy">
        {badgeLabel ? <span className={badgeClassName}>{badgeLabel}</span> : null}
        <div>
          <h2>{title}</h2>
          <p className="portal-notice-panel__description" data-testid={descriptionTestId}>{description}</p>
        </div>
      </div>
      {actions ? <div className="portal-inline-actions portal-notice-panel__actions">{actions}</div> : null}
    </section>
  );
}

export function PortalMetaList({
  items,
  testId,
}: {
  items: PortalMetaItem[];
  testId?: string;
}) {
  return (
    <dl className="portal-meta-list" data-testid={testId}>
      {items.map((item, index) => (
        <div className="portal-meta-list__row" key={`${item.label}-${index}`}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PortalShell({
  title,
  eyebrow,
  lede,
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
          <div className="portal-shell__chrome-top">
            <div className="portal-shell__brand-row">
              <Link className="portal-shell__brand" href="/">
                <span className="logo-mark">SL</span>
                <span>
                  <span className="brand-name">SpecLens portal</span>
                </span>
              </Link>
            </div>
            <div className="portal-shell__actions">
              <ThemeSwitcher compact />
              <Link className="button-ghost" href="/">Marketing</Link>
              <a className="button-secondary" href="/api/auth/logout">Log out</a>
            </div>
          </div>
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
      </header>
      <section className="portal-shell__intro">
        <div className="portal-shell__intro-card">
          <div className="portal-shell__title-row">
            <div>
              <p className="portal-shell__eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
            </div>
            {lede ? <p className="portal-shell__lede">{lede}</p> : null}
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
