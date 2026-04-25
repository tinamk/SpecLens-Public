import Link from "next/link";
import {
  MarketingRoutePanel,
  MarketingRouteSplit,
  MarketingSectionHeading,
  MarketingShell,
} from "@speclens/ui";
import { HomeStory } from "../components/home-story";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export default function HomePage() {
  return (
    <MarketingShell testId="public-home-page">
      <SiteHeader />
      <main data-testid="public-home-main" id="main-content" tabIndex={-1}>
        <section className="hero" data-testid="public-home-hero">
          <div className="hero-grid hero-grid--single">
            <div className="hero-copy">
              <p className="eyebrow">Specification-driven QA</p>
              <h1 className="text-balance">Run specification-driven QA against repositories under active change.</h1>
              <p className="hero-lede">
                Attach the source, execute the pack, review the release gate — with evidence tied to the exact commit under review.
              </p>
              <div className="hero__actions">
                <Link className="button" data-testid="public-home-start-hosted" href="/login">Open hosted portal</Link>
                <Link className="button-ghost" data-testid="public-home-view-pricing" href="/pricing">See hosted plans</Link>
              </div>
            </div>
          </div>
        </section>

        <HomeStory />

        <section className="section">
          <MarketingSectionHeading
            kicker="Choose the route"
            title="Hosted plans for execution. Commercial for rights."
          />

          <MarketingRouteSplit testId="public-home-decision-banner">
            <MarketingRoutePanel
              badgeLabel="Hosted SaaS"
              badgeClassName="tag tag--success"
              description="Free covers approved public Git hosts. Pro adds private GitHub repositories, Git archive uploads, and shared workspace access in hosted SpecLens."
              title="Choose hosted SaaS for the managed product."
              actions={
                <>
                  <Link className="button" data-testid="public-home-start-hosted-secondary" href="/login">Open hosted portal</Link>
                  <Link className="button-ghost" data-testid="public-home-compare-plans" href="/pricing">See hosted plans</Link>
                </>
              }
            />
            <MarketingRoutePanel
              badgeLabel="Commercial licensing"
              badgeClassName="tag tag--warning"
              description="Contact us if you need commercial-purpose self-hosting, codebase rights, procurement review, or a licensing path beyond the managed service."
              title="Choose commercial licensing for company rights."
              tone="commercial"
              actions={
                <>
                  <Link className="button" data-testid="public-home-contact-commercial" href="/commercial">
                    Talk commercial licensing
                  </Link>
                  <Link className="button-ghost" data-testid="public-home-license-details" href="/license">License details</Link>
                </>
              }
            />
          </MarketingRouteSplit>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
