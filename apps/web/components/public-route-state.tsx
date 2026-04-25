import type { ReactNode } from "react";
import { MarketingShell } from "@speclens/ui";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function PublicRouteState({
  actions,
  ariaLive,
  children,
  description,
  eyebrow,
  heroTestId,
  isLoading = false,
  mainTestId,
  role,
  testId,
  title,
}: {
  actions?: ReactNode;
  ariaLive?: "off" | "polite" | "assertive";
  children?: ReactNode;
  description: ReactNode;
  eyebrow: ReactNode;
  heroTestId: string;
  isLoading?: boolean;
  mainTestId: string;
  role?: "alert" | "status";
  testId: string;
  title: ReactNode;
}) {
  const sectionClassName = isLoading ? "status-hero route-loading" : "status-hero";
  const sectionAriaLive = ariaLive ?? (isLoading ? "polite" : undefined);
  const sectionRole = role ?? (isLoading ? "status" : undefined);

  return (
    <MarketingShell testId={testId}>
      <SiteHeader />
      <main className="legal-layout" data-testid={mainTestId} id="main-content" tabIndex={-1}>
        <section
          aria-live={sectionAriaLive}
          className={sectionClassName}
          data-testid={heroTestId}
          role={sectionRole}
        >
          {isLoading ? <div className="route-loading__spinner" aria-hidden="true" /> : null}
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-balance">{title}</h1>
          <p className="hero-lede">{description}</p>
          {children}
          {actions ? <div className="hero__actions">{actions}</div> : null}
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
