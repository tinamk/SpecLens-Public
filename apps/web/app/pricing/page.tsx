import Link from "next/link";
import { PricingCard } from "@speclens/ui";
import { CheckoutButton } from "../../components/portal-actions";
import { SiteHeader } from "../../components/site-header";
import { SiteFooter } from "../../components/site-footer";

export default function PricingPage() {
  return (
    <div className="marketing-shell" data-testid="public-pricing-page">
      <SiteHeader />
      <main data-testid="public-pricing-main">
        <section className="section">
          <div className="legal-hero" data-testid="public-pricing-hero">
            <p className="eyebrow">Pricing</p>
            <h1>Choose the hosted plan you need, then keep codebase rights explicit.</h1>
            <p className="hero-lede">
              Hosted Free and Pro govern usage of the managed SpecLens SaaS. Commercial licensing is a separate path for
              organizations that need broader rights, internal deployment, or procurement-specific terms.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="pricing-grid">
            <PricingCard
              name="Free"
              price="$0"
              description="Hosted evaluation and public-repo analysis."
              bullets={[
                "Public GitHub repositories only",
                "Create shared workspaces",
                "Hosted report rendering",
                "Live job console",
              ]}
              cta={<Link className="button-ghost" data-testid="public-pricing-free-cta" href="/api/auth/login">Use Free</Link>}
            />
            <div className="pricing-card--featured">
              <PricingCard
                name="Pro"
                price="$19.99 monthly / marketed as 200 NOK"
                description="Hosted access for private repos and Git repo archive uploads."
                bullets={[
                  "Private GitHub repos",
                  "ZIP/TAR Git repo uploads",
                  "Keycloak sign-in and shared workspaces",
                  "Stripe monthly billing in USD",
                ]}
                cta={<CheckoutButton label="Continue to checkout" testId="public-pricing-pro-checkout" />}
              />
            </div>
            <PricingCard
              name="Commercial license"
              price="Contact us"
              description="Commercial usage of the codebase or self-hosted deployments."
              bullets={[
                "Commercial rights beyond the non-commercial source-available license",
                "Company procurement flow",
                "Self-hosted and internal deployment discussions",
                "Direct contact path for tailored terms",
              ]}
              cta={<Link className="button-secondary" data-testid="public-pricing-commercial-cta" href="/commercial">Contact us</Link>}
            />
          </div>
        </section>

        <section className="section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Comparison</p>
              <h2>What changes between Free, Pro, and Commercial</h2>
            </div>
            <p className="section-copy">
              Use this as the quick decision table: SaaS access is one choice, codebase rights are another.
            </p>
          </div>
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

        <section className="section">
          <div className="comparison-grid">
            <article className="panel">
              <span className="tag tag--warning">Important distinction</span>
              <h3>Hosted usage and code licensing are not the same thing.</h3>
              <p>
                The managed service is sold as Free and Pro. The repository itself stays source-available and
                non-commercial by default unless a separate commercial agreement says otherwise.
              </p>
            </article>
            <article className="panel">
              <span className="tag tag--success">Need a team plan?</span>
              <h3>Commercial conversations cover the codebase and deployment shape.</h3>
              <p>Reach out if you need company rights, a contract review, or a self-hosted deployment discussion.</p>
              <Link className="button-secondary" href="/commercial">Open commercial contact</Link>
            </article>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
