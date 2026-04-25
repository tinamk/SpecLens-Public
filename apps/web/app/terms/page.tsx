import Link from "next/link";
import { MarketingPageHero, MarketingShell } from "@speclens/ui";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function TermsPage() {
  return (
    <MarketingShell testId="public-terms-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-terms-main" id="main-content" tabIndex={-1}>
        <MarketingPageHero
          eyebrow="Terms"
          title="Terms for the hosted service."
          description="Hosted Free and Pro apply to the managed SaaS. Commercial codebase licensing is handled separately."
          asideLabel="Plain-language rule"
          asideValue="Use the service responsibly, respect access controls, and expect hosted artifacts to follow retention policy."
          actions={
            <>
              <Link className="button-secondary" data-testid="public-terms-view-plans" href="/pricing">See hosted plans</Link>
              <Link className="button-ghost" data-testid="public-terms-privacy-details" href="/privacy">Privacy details</Link>
            </>
          }
          testId="public-terms-hero"
        />

        <section className="legal-grid">
          <article className="legal-panel">
            <span className="tag tag--neutral">Service usage</span>
            <h2>Service usage</h2>
            <p>
              By submitting a run you authorize SpecLens to execute the analysis in an isolated sandbox and store the
              resulting logs, artifacts, and reports needed to present results in the portal.
            </p>
            <p>Artifacts follow the configured retention policy and may be removed after the window expires.</p>
          </article>
          <article className="legal-panel">
            <span className="tag tag--warning">Access and billing</span>
            <h2>Access and billing</h2>
            <p>
              Payment access, private repository access, and hosted execution are subject to plan entitlements. Abuse or
              attempts to bypass authentication and billing may result in access revocation.
            </p>
          </article>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
