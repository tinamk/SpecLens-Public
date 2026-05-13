import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";

export function BrandLockup({
  href = "/",
  label = "SpecLens",
  className = "site-header__brand",
  testId,
}: {
  href?: Route;
  label?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Link className={className} data-testid={testId} href={href}>
      <span className="logo-mark" aria-hidden="true">SL</span>
      <span className="brand-name">{label}</span>
    </Link>
  );
}

export function MarketingShell({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="marketing-shell" data-testid={testId}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {children}
    </div>
  );
}

export function MarketingPageHero({
  eyebrow,
  title,
  description,
  asideLabel,
  asideValue,
  asideDescription,
  actions,
  testId,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  asideLabel: ReactNode;
  asideValue: ReactNode;
  asideDescription?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="page-hero" data-testid={testId}>
      <div className="page-hero__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="hero-lede">{description}</p>
        {actions ? <div className="hero__actions">{actions}</div> : null}
      </div>
      <aside className="page-hero__aside" aria-label="Page context">
        <p className="page-hero__stat-label">{asideLabel}</p>
        <p className="page-hero__stat-value">{asideValue}</p>
        {asideDescription ? <p>{asideDescription}</p> : null}
      </aside>
    </section>
  );
}

export function MarketingRouteSplit({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return <section className="route-split" data-testid={testId}>{children}</section>;
}

export function MarketingRoutePanel({
  badgeLabel,
  badgeClassName = "tag tag--neutral",
  title,
  description,
  actions,
  tone = "hosted",
}: {
  badgeLabel: ReactNode;
  badgeClassName?: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  tone?: "hosted" | "commercial";
}) {
  return (
    <article className={`route-split__panel route-split__panel--${tone}`}>
      <span className={badgeClassName}>{badgeLabel}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="route-split__actions">{actions}</div>
    </article>
  );
}

export function MarketingSectionHeading({
  kicker,
  title,
  copy,
}: {
  kicker: ReactNode;
  title: ReactNode;
  copy?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="section-kicker">{kicker}</p>
        <h2 className="text-balance">{title}</h2>
      </div>
      {copy ? <p className="section-copy">{copy}</p> : null}
    </div>
  );
}

export function PricingCard({
  name,
  price,
  description,
  bullets,
  cta,
  eyebrow,
  tone = "default",
}: {
  name: string;
  price: string;
  description: string;
  bullets: string[];
  cta: ReactNode;
  eyebrow?: string;
  tone?: "default" | "featured" | "contrast";
}) {
  const className = [
    "pricing-card",
    tone === "featured" ? "pricing-card--featured" : null,
    tone === "contrast" ? "pricing-card--contrast" : null,
  ].filter(Boolean).join(" ");
  const eyebrowLabel = eyebrow ?? (tone === "contrast" ? "Contract path" : "Hosted plan");
  return (
    <article className={className} data-plan={name.toLowerCase()}>
      <div className="pricing-card__header">
        <p className="pricing-card__eyebrow">{eyebrowLabel}</p>
        <h3>{name}</h3>
        <p className="pricing-card__price">{price}</p>
        <p>{description}</p>
      </div>
      <ul className="pricing-card__list">
        {bullets.map(item => <li key={item}>{item}</li>)}
      </ul>
      <div className="pricing-card__cta">{cta}</div>
    </article>
  );
}
