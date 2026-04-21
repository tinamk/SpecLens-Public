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
          title="Hosted SpecLens plans and commercial codebase rights are separate decisions."
          description="Use Free or Pro when you want the managed SpecLens SaaS. Use the commercial path when your company needs rights to self-host, modify, redistribute, or otherwise use the SpecLens codebase beyond the default non-commercial license."
          asideLabel="Quick rule"
          asideValue="Buy hosted access on Pricing. Ask for codebase rights on Commercial."
          asideDescription="This page is the routing guide for teams that need the distinction spelled out clearly."
          testId="public-license-hero"
        />

        <MarketingRouteSplit testId="public-license-decision-banner">
          <MarketingRoutePanel
            badgeLabel="Hosted SaaS"
            badgeClassName="tag tag--success"
            description="Free and Pro cover hosted repo analysis, shared workspaces, and the self-serve SaaS workflow. You do not need a separate commercial code license just to buy hosted access."
            title="Choose Pricing if you only need the managed service."
            actions={<Link className="button-secondary" data-testid="public-license-pricing-cta" href="/pricing">View hosted plans</Link>}
          />
          <MarketingRoutePanel
            badgeLabel="Commercial rights"
            badgeClassName="tag tag--warning"
            description="Commercial conversations cover company usage of the codebase, self-hosted deployment, redistribution questions, procurement review, and tailored contract terms."
            title="Choose Commercial if you need codebase rights or self-hosting."
            tone="commercial"
            actions={
              <Link className="button-ghost" data-testid="public-license-commercial-cta" href="/commercial">
                Talk commercial licensing
              </Link>
            }
          />
        </MarketingRouteSplit>

        <p className="subtle-note" data-testid="public-license-rights-note">
          Hosted Free and Pro plans govern SaaS usage only. Commercial codebase rights and self-hosting stay on a separate path.
        </p>

        <section className="legal-grid legal-grid--balanced">
          <article className="legal-panel">
            <span className="tag tag--warning">Common scenarios</span>
            <h2>Use this page as the quick routing guide.</h2>
            <ul className="bullet-list" data-testid="public-license-scenarios">
              <li>I want to sign up and use SpecLens in the cloud - go to Pricing.</li>
              <li>I need hosted access to private repositories - choose Pro on Pricing.</li>
              <li>I need to self-host SpecLens in my own environment - contact Commercial.</li>
              <li>I need company rights to modify, redistribute, or review the codebase - contact Commercial.</li>
            </ul>
          </article>
          <aside className="legal-panel">
            <span className="tag tag--success">What the default license means</span>
            <h3>Code access is source-available by default, but not sold under a permissive commercial open-source model.</h3>
            <ul className="bullet-list">
              <li>Hosted Free and Pro plans govern usage of the managed SpecLens SaaS.</li>
              <li>The repository code itself is not offered under a permissive commercial open-source license.</li>
              <li>Commercial self-hosted or company redistribution rights require a separate agreement.</li>
            </ul>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
