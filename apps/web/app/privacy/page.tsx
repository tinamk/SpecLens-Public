import Link from "next/link";
import { MarketingPageHero, MarketingShell } from "@speclens/ui";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function PrivacyPage() {
  return (
    <MarketingShell testId="public-privacy-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-privacy-main">
        <MarketingPageHero
          eyebrow="Privacy"
          title="SpecLens stores the hosted data needed to run workspaces, jobs, and reports - not more than that."
          description="The hosted platform keeps the metadata, logs, and artifacts required for the service while relying on configured third-party processors for payments, identity, and source access."
          asideLabel="Practical summary"
          asideValue="Store what keeps the product usable. Protect secrets. Retain artifacts by policy."
          actions={
            <>
              <Link className="button-secondary" href="/terms">Review terms</Link>
              <Link className="button-ghost" href="/commercial">Commercial questions</Link>
            </>
          }
          testId="public-privacy-hero"
        />

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
    </MarketingShell>
  );
}
