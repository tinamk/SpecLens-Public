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
            <h1>Pricing for hosted SpecLens.</h1>
            <p className="hero-lede">
              Use Free or Pro for the hosted SpecLens SaaS. Choose the commercial path when you need company usage rights,
              self-hosting, or procurement-specific terms.
            </p>
          </div>
          <div className="comparison-grid" data-testid="public-pricing-decision-banner">
            <article className="panel">
              <span className="tag tag--success">Hosted SaaS</span>
              <h2>Choose Pro if you need hosted access to private repos.</h2>
              <p>Free covers public GitHub analysis. Pro unlocks private GitHub repositories, archive uploads, and ongoing hosted use.</p>
            </article>
            <article className="panel">
              <span className="tag tag--warning">Commercial rights</span>
              <h2>Choose Commercial if you need company usage rights or self-hosting.</h2>
              <p>Commercial conversations cover codebase rights, internal deployment, procurement review, and tailored terms.</p>
            </article>
          </div>
          <p className="subtle-note" data-testid="public-pricing-rights-note">
            Free and Pro cover hosted SaaS usage only. They do not include commercial codebase rights.
          </p>
        </section>

        <section className="section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Hosted SaaS plans</p>
              <h2>Choose the self-serve plan for your hosted workflow.</h2>
            </div>
            <p className="section-copy">
              Free and Pro are the hosted product tiers. Commercial rights and self-hosting stay on a separate contact path.
            </p>
          </div>
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
              <div className="mb-3 flex items-center justify-center">
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
          </div>
          <article className="legal-hero legal-panel" data-testid="public-pricing-commercial-panel">
            <span className="tag tag--warning">Commercial path</span>
            <div>
              <h3>Commercial rights & self-hosting</h3>
              <p className="subtle-note">Need company usage rights, self-hosting, or procurement review?</p>
              <p>
                Commercial agreements cover codebase rights beyond the non-commercial source-available license, internal
                deployment discussions, and tailored commercial terms.
              </p>
            </div>
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
        </section>

        <section className="section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Comparison</p>
              <h2>Hosted plans vs. commercial licensing</h2>
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
