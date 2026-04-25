import Link from "next/link";
import { MarketingPageHero, MarketingShell } from "@speclens/ui";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function PrivacyPage() {
  return (
    <MarketingShell testId="public-privacy-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-privacy-main" id="main-content" tabIndex={-1}>
        <MarketingPageHero
          eyebrow="Privacy"
          title="What SpecLens stores, and why."
          description="The hosted platform keeps the metadata, logs, and artifacts needed to run the service, and uses configured processors for payments, identity, and source access."
          asideLabel="Practical summary"
          asideValue="Store what keeps the product usable. Protect secrets. Retain artifacts by policy."
          actions={
            <>
              <Link className="button-secondary" data-testid="public-privacy-review-terms" href="/terms">Review terms</Link>
              <Link className="button-ghost" data-testid="public-privacy-commercial-questions" href="/commercial">Ask about data terms</Link>
            </>
          }
          testId="public-privacy-hero"
        />

        <section className="legal-grid">
          <article className="legal-panel">
            <span className="tag tag--success">What is stored</span>
            <h2>Stored workspace and run data</h2>
            <p>Workspace metadata, source references, job logs, and report artifacts needed to operate the service.</p>
            <p>Artifacts may include logs, screenshots, and exported reports. Workspace secrets are encrypted at rest and used only to perform the requested analysis.</p>
          </article>
          <article className="legal-panel">
            <span className="tag tag--info">Processors and retention</span>
            <h2>Processors and retention</h2>
            <p>Payments via Stripe, identity via Keycloak, source access via GitHub App. Object storage is S3-compatible and can be internal or external.</p>
            <p>Retention settings determine how long logs and artifacts are kept.</p>
          </article>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
