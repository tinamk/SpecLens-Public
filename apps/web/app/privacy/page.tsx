import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function PrivacyPage() {
  return (
    <div className="marketing-shell" data-testid="public-privacy-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-privacy-main">
        <section className="legal-hero" data-testid="public-privacy-hero">
          <p className="eyebrow">Privacy</p>
          <h1>SpecLens stores only the hosted data needed to operate workspaces, runs, and reports.</h1>
          <p className="hero-lede">
            The hosted platform keeps metadata, logs, and artifacts required for the service experience while relying on
            configured third-party processors for payments, identity, and source access.
          </p>
        </section>

        <section className="legal-grid">
          <article className="legal-panel">
            <span className="tag tag--success">What is stored</span>
            <p>
              SpecLens stores workspace metadata, source references, job logs, and report artifacts needed to operate the
              hosted service.
            </p>
            <p>
              Artifacts may include logs, screenshots, exported reports, and analysis evidence generated during hosted runs.
              Workspace secrets are stored encrypted at rest and are only used to perform the analysis you requested.
            </p>
          </article>
          <article className="legal-panel">
            <span className="tag tag--info">Processors and retention</span>
            <p>
              SpecLens uses third-party processors for payments (Stripe), identity (Keycloak), and source access (GitHub
              App). Object storage is S3-compatible and can be hosted internally or by a configured external provider.
            </p>
            <p>Retention settings determine how long logs and artifacts are kept before cleanup.</p>
          </article>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
