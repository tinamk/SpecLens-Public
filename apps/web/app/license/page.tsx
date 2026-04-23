import Link from "next/link";
import { MarketingPageHero, MarketingRoutePanel, MarketingRouteSplit, MarketingShell } from "@speclens/ui";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function LicensePage() {
  return (
    <MarketingShell testId="public-license-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-license-main">
        <MarketingPageHero
          eyebrow="Dual licensing"
          title="Hosted plans and codebase rights are separate decisions."
          description="Hosted Free and Pro cover the managed SaaS. Commercial is a separate contract path for self-hosting, redistribution, or company use of the codebase."
          asideLabel="Quick rule"
          asideValue="Buy hosted access on Pricing. Ask for codebase rights on Commercial."
          testId="public-license-hero"
        />

        <MarketingRouteSplit testId="public-license-decision-banner">
          <MarketingRoutePanel
            badgeLabel="Hosted SaaS"
            badgeClassName="tag tag--success"
            description="Hosted Free and Pro do not require a separate code license."
            title="Choose Pricing if you only need the managed service."
            actions={
              <>
                <Link className="button" data-testid="public-license-pricing-cta" href="/pricing">View hosted plans</Link>
                <Link className="button-ghost" href="/api/auth/login">Try hosted</Link>
              </>
            }
          />
          <MarketingRoutePanel
            badgeLabel="Commercial rights"
            badgeClassName="tag tag--warning"
            description="Self-hosting, redistribution, and company codebase use need a commercial agreement."
            title="Choose Commercial if you need codebase rights or self-hosting."
            tone="commercial"
            actions={
              <>
                <Link className="button" data-testid="public-license-commercial-cta" href="/commercial">
                  Talk commercial licensing
                </Link>
                <Link className="button-ghost" href="/pricing">Compare plans</Link>
              </>
            }
          />
        </MarketingRouteSplit>

        <p className="subtle-note" data-testid="public-license-rights-note">
          Hosted Free and Pro plans govern SaaS usage only. Codebase rights stay on the commercial path.
        </p>

        <section className="legal-grid legal-grid--balanced">
          <article className="legal-panel">
            <span className="tag tag--warning">Common scenarios</span>
            <h2>Quick routing guide</h2>
            <ul className="bullet-list" data-testid="public-license-scenarios">
              <li>I want hosted access in the cloud - go to Pricing.</li>
              <li>I need private repositories - choose Pro on Pricing.</li>
              <li>I need to self-host SpecLens in my own environment - contact Commercial.</li>
              <li>I need company rights to modify, redistribute, or review the codebase - contact Commercial.</li>
            </ul>
          </article>
          <aside className="legal-panel">
            <span className="tag tag--success">Default license</span>
            <h3>Source-available, not permissive open-source.</h3>
            <ul className="bullet-list">
              <li>Hosted plans govern use of the managed SaaS.</li>
              <li>The codebase is not offered under a permissive commercial open-source license.</li>
              <li>Self-hosting and company redistribution require a commercial agreement.</li>
            </ul>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
