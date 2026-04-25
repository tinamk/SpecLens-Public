import Link from "next/link";
import { MarketingPageHero, MarketingRoutePanel, MarketingRouteSplit, MarketingShell } from "@speclens/ui";
import CommercialContactForm from "../../components/commercial-contact-form";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function CommercialPage() {
  return (
    <MarketingShell testId="public-commercial-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-commercial-main" id="main-content" tabIndex={-1}>
        <MarketingPageHero
          eyebrow="Commercial licensing"
          title="Commercial rights, commercial-purpose self-hosting, and procurement-led rollout."
          description="The contract path for commercial codebase use, commercial-purpose self-hosted deployment, and procurement review. For hosted private repo access, use Pro."
          asideLabel="Best fit"
          asideValue="Use Commercial when the question is rights, procurement, or deployment control."
          testId="public-commercial-hero"
        />

        <MarketingRouteSplit testId="public-commercial-decision-banner">
          <MarketingRoutePanel
            badgeLabel="Hosted self-serve"
            badgeClassName="tag tag--success"
            description="Self-serve SaaS for private GitHub repositories, Git archive uploads, and shared workspaces."
            title="Choose Pro for the managed hosted product."
            actions={
              <>
                <Link className="button" data-testid="public-commercial-pro-cta" href="/pricing">See hosted plans</Link>
                <Link className="button-ghost" data-testid="public-commercial-open-portal" href="/login">Open hosted portal</Link>
              </>
            }
          />
          <MarketingRoutePanel
            badgeLabel="Commercial contract"
            badgeClassName="tag tag--warning"
            description="For commercial codebase rights, internal deployment tied to commercial work, or terms beyond the hosted plans."
            title="Choose Commercial for commercial rights, commercial-purpose self-hosting, or procurement review."
            tone="commercial"
            actions={
              <>
                <Link className="button" data-testid="public-commercial-send-request" href="#commercial-request">Send request</Link>
                <Link className="button-ghost" data-testid="public-commercial-license-details" href="/license">License details</Link>
              </>
            }
          />
        </MarketingRouteSplit>

        <p className="subtle-note subtle-note--page" data-testid="public-commercial-next-step-note">
          Tell us what commercial deployment model, procurement review, or rights question you need to solve and we will route you to the right contract path.
        </p>

        <section className="legal-grid legal-grid--balanced">
          <div className="legal-panel">
            <span className="tag tag--warning">Commercial scope</span>
            <h2>What commercial covers</h2>
            <ul className="bullet-list">
              <li>Commercial use of the SpecLens codebase</li>
              <li>Offering SpecLens as a hosted or managed commercial service</li>
              <li>Commercial-purpose self-hosted and internal deployment</li>
              <li>Procurement and contract review</li>
              <li>Security or compliance usage terms</li>
            </ul>
            <div className="legal-contact-card">
              <p><strong>Contact:</strong> hello@tinamk.no</p>
            </div>
          </div>
          <div className="legal-panel" id="commercial-request">
            <p className="eyebrow">Commercial inquiry</p>
            <h2>Send a commercial licensing request</h2>
            <CommercialContactForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
