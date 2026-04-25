import Link from "next/link";
import {
  MarketingPageHero,
  MarketingRoutePanel,
  MarketingRouteSplit,
  MarketingSectionHeading,
  MarketingShell,
  PricingCard,
} from "@speclens/ui";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function PricingPage() {
  return (
    <MarketingShell testId="public-pricing-page">
      <SiteHeader />
      <main data-testid="public-pricing-main" id="main-content" tabIndex={-1}>
        <MarketingPageHero
          eyebrow="Pricing"
          title="Hosted plans for specification-driven QA."
          description="Free for approved public Git hosts. Pro for private GitHub repositories and archive uploads. Commercial is a separate contract path for codebase rights."
          asideLabel="Quick rule"
          asideValue="Hosted plans cover execution. Commercial covers rights and commercial-purpose self-hosting."
          testId="public-pricing-hero"
        />

        <MarketingRouteSplit testId="public-pricing-decision-banner">
          <MarketingRoutePanel
            badgeLabel="Hosted SaaS"
            badgeClassName="tag tag--success"
            description="Approved public Git hosts on Free. Private GitHub and archive uploads on Pro."
            title="Choose Pro if you need hosted access to private GitHub repos."
            actions={
              <>
                <Link className="button" data-testid="public-pricing-open-portal" href="/login">Open hosted portal</Link>
                <Link className="button-ghost" data-testid="public-pricing-compare-plans" href="#pricing-plans">Compare plans</Link>
              </>
            }
          />
          <MarketingRoutePanel
            badgeLabel="Commercial rights"
            badgeClassName="tag tag--warning"
            description="Codebase rights, commercial-purpose self-hosting, and procurement review live on a separate contract path."
            title="Choose Commercial for company rights or commercial-purpose self-hosting."
            tone="commercial"
            actions={
              <>
                <Link className="button" data-testid="public-pricing-commercial-licensing" href="/commercial">Commercial licensing</Link>
                <Link className="button-ghost" data-testid="public-pricing-license-details" href="/license">License details</Link>
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
                "Approved public Git repositories from GitHub, GitLab, Bitbucket, or Codeberg",
                "Shared workspaces",
                "Hosted reports and logs",
              ]}
              cta={<Link className="button-secondary" data-testid="public-pricing-free-cta" href="/login">Open hosted portal</Link>}
            />
            <PricingCard
              name="Pro"
              price="$19.99"
              description="per month, for private-repository QA and archive uploads."
              bullets={[
                "Private GitHub via the GitHub App",
                "ZIP/TAR Git archive uploads",
                "Shared workspaces",
                "Approx. 200 NOK billed monthly in USD",
              ]}
              cta={<Link className="button" data-testid="public-pricing-pro-checkout" href="/login">Open portal to start Pro</Link>}
              tone="featured"
            />
            <PricingCard
              name="Commercial rights & deployments"
              price="Talk to us"
              description="Company usage rights, commercial-purpose self-hosting, or procurement review."
              bullets={[
                "Commercial rights for company usage of the codebase",
                "Commercial-purpose self-hosted deployment discussions",
                "Procurement-friendly agreement path",
              ]}
              cta={<Link className="button-secondary" data-testid="public-pricing-commercial-cta" href="/commercial">Commercial licensing</Link>}
              tone="contrast"
            />
          </div>
        </section>

        <section className="section">
          <MarketingSectionHeading
            kicker="Comparison"
            title="Hosted plans vs. commercial licensing"
          />
          <table className="comparison-table">
            <caption>Capability comparison for hosted and commercial SpecLens paths.</caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Free</th>
                <th scope="col">Pro</th>
                <th scope="col">Commercial</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Repository access</th>
                <td>Approved public Git hosts</td>
                <td>Approved public Git hosts + private GitHub</td>
                <td>Per agreement</td>
              </tr>
              <tr>
                <th scope="row">Source intake</th>
                <td>Public GitHub, GitLab, Bitbucket, and Codeberg</td>
                <td>Public Git + private GitHub + ZIP/TAR Git archives</td>
                <td>Self-hosted / internal under contract</td>
              </tr>
              <tr>
                <th scope="row">Billing</th>
                <td>Free</td>
                <td>Self-serve Stripe</td>
                <td>Contract + procurement</td>
              </tr>
              <tr>
                <th scope="row">Codebase rights</th>
                <td>Not included</td>
                <td>Not included</td>
                <td>Negotiated</td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
