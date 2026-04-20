import Link from "next/link";
import CommercialContactForm from "../../components/commercial-contact-form";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function CommercialPage() {
  return (
    <div className="marketing-shell" data-testid="public-commercial-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-commercial-main">
        <section className="legal-hero" data-testid="public-commercial-hero">
          <p className="eyebrow">Commercial licensing</p>
          <h1>Need commercial rights, procurement support, or a self-hosted deployment path?</h1>
          <p className="hero-lede">
            Commercial is the contract-based path for company codebase rights, self-hosting discussions, and procurement-led
            rollout. If you only need hosted access to private repositories, use Pro on the pricing page instead.
          </p>
        </section>

        <section className="comparison-grid" data-testid="public-commercial-decision-banner">
          <article className="panel">
            <span className="tag tag--success">Hosted self-serve</span>
            <h2>Choose Pro for the managed hosted product.</h2>
            <p>
              Pro is the self-serve SaaS tier for teams that need hosted access to private repositories, archive uploads, and
              shared workspace workflows.
            </p>
            <div>
              <Link className="button-secondary" data-testid="public-commercial-pro-cta" href="/pricing">
                Review hosted plans
              </Link>
            </div>
          </article>
          <article className="panel">
            <span className="tag tag--warning">Commercial contract</span>
            <h2>Choose Commercial for codebase rights, self-hosting, or procurement review.</h2>
            <p>
              Use this path when your organization needs company usage rights for the SpecLens codebase, internal deployment
              discussions, or contract terms beyond the standard hosted plans.
            </p>
          </article>
        </section>

        <p className="subtle-note" data-testid="public-commercial-next-step-note">
          Tell us what deployment model, procurement review, or rights question you need to solve and we will route you to the
          right contract path.
        </p>

        <section className="legal-grid">
          <div className="legal-panel">
            <span className="tag tag--warning">Commercial scope</span>
            <h2>What commercial conversations cover</h2>
            <ul className="bullet-list">
              <li>Commercial code licensing for company use of the SpecLens codebase</li>
              <li>Self-hosted deployment and internal environment discussions</li>
              <li>Procurement, vendor onboarding, and contract review</li>
              <li>Company-specific usage terms for security or compliance constraints</li>
            </ul>
            <div>
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
    </div>
  );
}
