import Link from "next/link";
import {
  MarketingPageHero,
  MarketingRoutePanel,
  MarketingRouteSplit,
  MarketingSectionHeading,
  MarketingShell,
  PricingCard,
} from "@speclens/ui";
import { CheckoutButton } from "../../components/portal-actions";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function PricingPage() {
  return (
    <MarketingShell testId="public-pricing-page">
      <SiteHeader />
      <main data-testid="public-pricing-main">
        <MarketingPageHero
          eyebrow="Pricing"
          title="Choose hosted access when you need the managed service. Choose commercial when you need company rights."
          description="Free and Pro are for the hosted SpecLens product. Commercial is the separate contract path for self-hosting, procurement review, or rights to use the codebase beyond the default license."
          asideLabel="Decision rule"
          asideValue="Service access and codebase rights are not the same purchase."
          asideDescription="Use this page to route quickly instead of decoding licensing language after the fact."
          testId="public-pricing-hero"
        />

        <MarketingRouteSplit testId="public-pricing-decision-banner">
          <MarketingRoutePanel
            badgeLabel="Hosted SaaS"
            badgeClassName="tag tag--success"
            description="Free covers public GitHub analysis. Pro unlocks private GitHub repositories, archive uploads, and ongoing hosted use."
            title="Choose Pro if you need hosted access to private repos."
          />
          <MarketingRoutePanel
            badgeLabel="Commercial rights"
            badgeClassName="tag tag--warning"
            description="Commercial conversations cover codebase rights, internal deployment, procurement review, and tailored terms."
            title="Choose Commercial if you need company usage rights or self-hosting."
            tone="commercial"
          />
        </MarketingRouteSplit>

        <p className="subtle-note" data-testid="public-pricing-rights-note">
          Free and Pro cover hosted SaaS usage only. They do not include commercial codebase rights.
        </p>

        <section className="section">
          <MarketingSectionHeading
            kicker="Hosted SaaS plans"
            title="Choose the self-serve plan for your hosted workflow."
            copy="The hosted product is intentionally simple to buy. Rights to deploy or commercially use the codebase stay on the separate commercial path."
          />
          <div className="pricing-grid">
            <PricingCard
              name="Free"
              price="$0"
              description="Hosted evaluation and public-repo analysis."
              bullets={[
                "Public GitHub repositories only",
                "Shared workspaces",
                "Hosted report rendering",
                "Live job console",
              ]}
              cta={<Link className="button-ghost" data-testid="public-pricing-free-cta" href="/api/auth/login">Use Free</Link>}
            />
            <div className="pricing-card--featured">
              <div className="pricing-card--featured-banner">
                <span className="tag tag--success">Recommended for private repos</span>
              </div>
              <PricingCard
                name="Pro"
                price="$19.99/month"
                description="Hosted access for private repositories and Git repo archive uploads."
                bullets={[
                  "Private GitHub repos",
                  "ZIP/TAR Git repo uploads",
                  "Keycloak sign-in and shared workspaces",
                  "Approx. 200 NOK, billed monthly in USD",
                ]}
                cta={<CheckoutButton label="Start Pro" testId="public-pricing-pro-checkout" />}
              />
            </div>
            <article className="pricing-contrast">
              <span className="tag tag--warning">Commercial path</span>
              <h3>Commercial rights & self-hosting</h3>
              <p className="subtle-note">Need company usage rights, self-hosting, or procurement review?</p>
              <p>
                Commercial agreements cover codebase rights beyond the non-commercial source-available license, internal
                deployment discussions, and tailored commercial terms.
              </p>
              <ul className="pricing-card__list">
                <li>Commercial rights for company usage of the codebase</li>
                <li>Self-hosted and internal deployment discussions</li>
                <li>Procurement-friendly commercial agreement path</li>
                <li>Direct contact for tailored terms</li>
              </ul>
              <div>
                <Link className="button-secondary" data-testid="public-pricing-commercial-cta" href="/commercial">Contact us</Link>
              </div>
            </article>
          </div>
        </section>

        <section className="section">
          <MarketingSectionHeading
            kicker="Comparison"
            title="Hosted plans vs. commercial licensing"
            copy="Use the hosted tiers when you want the managed workflow. Use commercial when the question is rights or deployment."
          />
          <div className="comparison-table">
            <div className="comparison-row comparison-row--head">
              <div className="comparison-cell comparison-cell--plan"><strong>Capability</strong></div>
              <div className="comparison-cell"><strong>Free</strong></div>
              <div className="comparison-cell"><strong>Pro</strong></div>
              <div className="comparison-cell"><strong>Commercial</strong></div>
            </div>
            <div className="comparison-row">
              <div className="comparison-cell comparison-cell--plan">Repository access</div>
              <div className="comparison-cell">Public GitHub repositories</div>
              <div className="comparison-cell">Public and private repositories through the hosted product</div>
              <div className="comparison-cell">Depends on the commercial agreement and deployment model</div>
            </div>
            <div className="comparison-row">
              <div className="comparison-cell comparison-cell--plan">Source intake</div>
              <div className="comparison-cell">Direct public Git URLs</div>
              <div className="comparison-cell">Public Git, private GitHub, and ZIP/TAR Git repo uploads</div>
              <div className="comparison-cell">Tailored for internal or self-hosted usage</div>
            </div>
            <div className="comparison-row">
              <div className="comparison-cell comparison-cell--plan">Billing path</div>
              <div className="comparison-cell">No charge</div>
              <div className="comparison-cell">Self-serve Stripe subscription</div>
              <div className="comparison-cell">Direct contact and procurement flow</div>
            </div>
            <div className="comparison-row">
              <div className="comparison-cell comparison-cell--plan">Codebase rights</div>
              <div className="comparison-cell">No commercial code rights</div>
              <div className="comparison-cell">No commercial code rights</div>
              <div className="comparison-cell">Commercial rights and self-hosting terms are negotiated here</div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
