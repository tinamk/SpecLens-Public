import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function TermsPage() {
  return (
    <div className="marketing-shell" data-testid="public-terms-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-terms-main">
        <section className="legal-hero" data-testid="public-terms-hero">
          <p className="eyebrow">Terms</p>
          <h1>Hosted terms focus on safe usage of the managed service and its artifacts.</h1>
          <p className="hero-lede">
            Hosted Free and Pro plans apply to the managed SpecLens SaaS. Commercial licensing for the codebase is handled
            separately.
          </p>
        </section>

        <section className="legal-grid">
          <article className="legal-panel">
            <span className="tag tag--neutral">Service usage</span>
            <p>
              By submitting a run you authorize SpecLens to execute the analysis in an isolated sandbox and to store the
              resulting logs, artifacts, and reports needed to present results in the portal.
            </p>
            <p>
              These artifacts are retained according to the configured retention policy and may be removed after the
              retention window expires.
            </p>
          </article>
          <article className="legal-panel">
            <span className="tag tag--warning">Access and billing</span>
            <p>
              Payment access, private repository access, and hosted execution are subject to plan entitlements. Abuse,
              unauthorized access, or attempts to bypass authentication and billing checks may result in access revocation.
            </p>
          </article>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
