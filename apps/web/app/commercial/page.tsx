import Link from "next/link";
import { MarketingPageHero, MarketingRoutePanel, MarketingRouteSplit, MarketingShell } from "@speclens/ui";
import CommercialContactForm from "../../components/commercial-contact-form";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function CommercialPage() {
  return (
    <MarketingShell testId="public-commercial-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-commercial-main">
        <MarketingPageHero
          eyebrow="Commercial licensing"
          title="Need commercial rights, procurement support, or a self-hosted deployment path?"
          description="Commercial is the contract-based path for company codebase rights, self-hosting discussions, and procurement-led rollout. If you only need hosted access to private repositories, use Pro on the pricing page instead."
          asideLabel="Best fit"
          asideValue="Use Commercial when the question is rights, procurement, or deployment control."
          asideDescription="If the question is just private repository access inside the hosted product, Pro is the faster path."
          testId="public-commercial-hero"
        />

        <MarketingRouteSplit testId="public-commercial-decision-banner">
          <MarketingRoutePanel
            badgeLabel="Hosted self-serve"
            badgeClassName="tag tag--success"
            description="Pro is the self-serve SaaS tier for teams that need hosted access to private repositories, archive uploads, and shared workspace workflows."
            title="Choose Pro for the managed hosted product."
            actions={<Link className="button-secondary" data-testid="public-commercial-pro-cta" href="/pricing">Review hosted plans</Link>}
          />
          <MarketingRoutePanel
            badgeLabel="Commercial contract"
            badgeClassName="tag tag--warning"
            description="Use this path when your organization needs company usage rights for the SpecLens codebase, internal deployment discussions, or contract terms beyond the standard hosted plans."
            title="Choose Commercial for codebase rights, self-hosting, or procurement review."
            tone="commercial"
          />
        </MarketingRouteSplit>

        <p className="subtle-note" data-testid="public-commercial-next-step-note">
          Tell us what deployment model, procurement review, or rights question you need to solve and we will route you to the
          right contract path.
        </p>

        <section className="legal-grid legal-grid--balanced">
          <div className="legal-panel">
            <span className="tag tag--warning">Commercial scope</span>
            <h2>What commercial conversations cover</h2>
            <ul className="bullet-list">
              <li>Commercial code licensing for company use of the SpecLens codebase</li>
              <li>Self-hosted deployment and internal environment discussions</li>
              <li>Procurement, vendor onboarding, and contract review</li>
              <li>Company-specific usage terms for security or compliance constraints</li>
            </ul>
            <div className="legal-contact-card">
              <p><strong>Contact:</strong> hello@tinamk.no</p>
              <p className="subtle-note">Typical next step: we review your request and reply with the relevant contract or deployment path.</p>
            </div>
          </div>
          <div className="legal-panel">
            <p className="eyebrow">Request access</p>
            <h2>Send a commercial licensing request</h2>
            <p>Share your licensing or self-hosting needs and we will follow up with the right contract path.</p>
            <CommercialContactForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
