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
          title="Hosted plans for specification-driven QA."
          description="Free for public repos. Pro for private repos and archive uploads. Commercial is a separate contract path for codebase rights."
          asideLabel="Quick rule"
          asideValue="Hosted plans cover execution. Commercial covers rights and self-hosting."
          testId="public-pricing-hero"
        />

        <MarketingRouteSplit testId="public-pricing-decision-banner">
          <MarketingRoutePanel
            badgeLabel="Hosted SaaS"
            badgeClassName="tag tag--success"
            description="Public GitHub on Free. Private GitHub and archive uploads on Pro."
            title="Choose Pro if you need hosted access to private repos."
            actions={
              <>
                <Link className="button" href="/api/auth/login">Start hosted</Link>
                <Link className="button-ghost" href="#pricing-plans">Compare plans</Link>
              </>
            }
          />
          <MarketingRoutePanel
            badgeLabel="Commercial rights"
            badgeClassName="tag tag--warning"
            description="Codebase rights, self-hosting, and procurement review live on a separate contract path."
            title="Choose Commercial for company rights or self-hosting."
            tone="commercial"
            actions={
              <>
                <Link className="button" href="/commercial">Contact us</Link>
                <Link className="button-ghost" href="/license">License details</Link>
              </>
            }
          />
        </MarketingRouteSplit>

        <p className="subtle-note pricing-note" data-testid="public-pricing-rights-note">
          Free and Pro cover hosted SaaS usage only. They do not include commercial codebase rights.
        </p>

        <section className="section" id="pricing-plans">
          <MarketingSectionHeading
            kicker="Hosted plans"
            title="Pick the plan that matches your source access."
          />
          <div className="pricing-grid">
            <PricingCard
              name="Free"
              price="$0"
              description="For public-repository QA."
              bullets={[
                "Public GitHub repositories",
                "Shared workspaces",
                "Hosted reports and logs",
              ]}
              cta={<Link className="button-secondary" data-testid="public-pricing-free-cta" href="/api/auth/login">Use Free</Link>}
            />
            <PricingCard
              name="Pro"
              price="$19.99"
              description="per month, for private-repository QA and archive uploads."
              bullets={[
                "Private GitHub repos",
                "ZIP/TAR Git repo uploads",
                "Shared workspaces",
                "Approx. 200 NOK billed monthly in USD",
              ]}
              cta={<CheckoutButton label="Start Pro" testId="public-pricing-pro-checkout" />}
              tone="featured"
            />
            <PricingCard
              name="Commercial rights & self-hosting"
              price="Talk to us"
              description="Company usage rights, self-hosting, or procurement review."
              bullets={[
                "Commercial rights for company usage of the codebase",
                "Self-hosted deployment discussions",
                "Procurement-friendly agreement path",
              ]}
              cta={<Link className="button-secondary" data-testid="public-pricing-commercial-cta" href="/commercial">Contact us</Link>}
              tone="contrast"
            />
          </div>
        </section>

        <section className="section">
          <MarketingSectionHeading
            kicker="Comparison"
            title="Hosted plans vs. commercial licensing"
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
              <div className="comparison-cell">Public GitHub</div>
              <div className="comparison-cell">Public + private GitHub</div>
              <div className="comparison-cell">Per agreement</div>
            </div>
            <div className="comparison-row">
              <div className="comparison-cell comparison-cell--plan">Source intake</div>
              <div className="comparison-cell">Public Git URLs</div>
              <div className="comparison-cell">Git URLs + ZIP/TAR uploads</div>
              <div className="comparison-cell">Self-hosted / internal</div>
            </div>
            <div className="comparison-row">
              <div className="comparison-cell comparison-cell--plan">Billing</div>
              <div className="comparison-cell">Free</div>
              <div className="comparison-cell">Self-serve Stripe</div>
              <div className="comparison-cell">Contract + procurement</div>
            </div>
            <div className="comparison-row">
              <div className="comparison-cell comparison-cell--plan">Codebase rights</div>
              <div className="comparison-cell">—</div>
              <div className="comparison-cell">—</div>
              <div className="comparison-cell">Negotiated</div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
