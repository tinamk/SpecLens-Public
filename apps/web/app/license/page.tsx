import Link from "next/link";
import { MarketingPageHero, MarketingRoutePanel, MarketingRouteSplit, MarketingShell } from "@speclens/ui";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function LicensePage() {
  return (
    <MarketingShell testId="public-license-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-license-main" id="main-content" tabIndex={-1}>
        <MarketingPageHero
          eyebrow="Dual licensing"
          title="Hosted plans and codebase rights are separate decisions."
          description="Hosted Free and Pro cover the managed SaaS. The source license allows non-commercial use and redistribution when license notices stay intact; commercial use, commercial-purpose self-hosting, and commercial redistribution need a separate agreement."
          asideLabel="Quick rule"
          asideValue="Buy hosted access on Pricing. Ask for commercial codebase rights on Commercial."
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
                <Link className="button" data-testid="public-license-pricing-cta" href="/pricing">See hosted plans</Link>
                <Link className="button-ghost" data-testid="public-license-open-portal" href="/login">Open hosted portal</Link>
              </>
            }
          />
          <MarketingRoutePanel
            badgeLabel="Commercial rights"
            badgeClassName="tag tag--warning"
            description="Commercial use of the codebase, commercial-purpose self-hosting, and commercial redistribution need a commercial agreement."
            title="Choose Commercial if you need codebase rights or commercial-purpose self-hosting."
            tone="commercial"
            actions={
              <>
                <Link className="button" data-testid="public-license-commercial-cta" href="/commercial">
                  Talk commercial licensing
                </Link>
                <Link className="button-ghost" data-testid="public-license-compare-plans" href="/pricing">See hosted plans</Link>
              </>
            }
          />
        </MarketingRouteSplit>

        <p className="subtle-note subtle-note--page" data-testid="public-license-rights-note">
          Hosted Free and Pro plans govern SaaS usage only. Non-commercial source use follows the repository license; commercial codebase rights stay on the commercial path.
        </p>

        <section className="legal-grid legal-grid--balanced">
          <article className="legal-panel">
            <span className="tag tag--warning">Common scenarios</span>
            <h2>Quick routing guide</h2>
            <ul className="bullet-list" data-testid="public-license-scenarios">
              <li>I want hosted access in the cloud - go to Pricing.</li>
              <li>I need private GitHub repositories - choose Pro on Pricing.</li>
              <li>I need to self-host SpecLens for commercial-purpose internal use - contact Commercial.</li>
              <li>I want to offer SpecLens as a hosted or managed commercial service - contact Commercial.</li>
              <li>I need commercial rights to modify, redistribute, or use the codebase for paid/internal business work - contact Commercial.</li>
            </ul>
          </article>
          <aside className="legal-panel">
            <span className="tag tag--success">Default license</span>
            <h3>Source-available, not permissive open-source.</h3>
            <ul className="bullet-list">
              <li>Hosted plans govern use of the managed SaaS.</li>
              <li>The codebase is not offered under a permissive commercial open-source license.</li>
              <li>Non-commercial redistribution follows the repository license with notices retained; commercial redistribution requires a commercial agreement.</li>
            </ul>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
