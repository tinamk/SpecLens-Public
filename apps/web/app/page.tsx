import Link from "next/link";
import { PricingCard } from "@speclens/ui";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";

export default function HomePage() {
  return (
    <div className="marketing-shell" data-testid="public-home-page">
      <SiteHeader />
      <main data-testid="public-home-main">
        <section className="hero" data-testid="public-home-hero">
          <div className="hero-card">
            <div className="hero-grid">
              <div className="hero-copy">
                <p className="eyebrow">Spec-driven repository intelligence</p>
                <h1 className="text-balance">Understand a repo&apos;s risks, behavior, and next moves before you inherit the work.</h1>
                <p className="hero-lede">
                  SpecLens turns source trees, runtime signals, and hosted job output into reviewable narratives with live
                  logs, structured findings, and portal-ready artifacts for teams inheriting unfamiliar repositories.
                </p>
                <div className="hero-decision-banner" data-testid="public-home-decision-banner">
                  <article className="hero-decision-card hero-decision-card--hosted">
                    <span className="tag tag--success">Hosted SaaS</span>
                    <h2>Choose hosted SaaS for the managed product.</h2>
                    <p>
                      Free covers public GitHub repos. Pro adds private repositories, archive uploads, and shared workspace
                      access inside SpecLens Cloud.
                    </p>
                    <div className="hero-decision-card__actions">
                      <Link className="button" data-testid="public-home-start-hosted" href="/api/auth/login">Try hosted SaaS</Link>
                      <Link className="button-ghost" data-testid="public-home-view-pricing" href="/pricing">See hosted pricing</Link>
                    </div>
                  </article>
                  <article className="hero-decision-card hero-decision-card--commercial">
                    <span className="tag tag--warning">Commercial licensing</span>
                    <h2>Choose commercial licensing for company rights.</h2>
                    <p>
                      Contact us if you need company usage rights for the codebase, self-hosting, procurement review, or a
                      licensing path beyond the managed SaaS plans.
                    </p>
                    <div className="hero-decision-card__actions">
                      <Link className="button-secondary" data-testid="public-home-contact-commercial" href="/commercial">Talk commercial licensing</Link>
                    </div>
                  </article>
                </div>
              </div>

              <div className="hero-stage">
                <div className="hero-stage__panel">
                  <span className="tag tag--neutral">Hosted flow</span>
                  <div className="hero-stage__steps">
                    <article className="hero-stage__step">
                      <span className="hero-stage__step-label">01 Queue a source</span>
                      <p>Connect a public Git repo, a private GitHub installation, or a Git repo archive upload.</p>
                    </article>
                    <article className="hero-stage__step">
                      <span className="hero-stage__step-label">02 Watch the run</span>
                      <p>Follow durable job logs from isolated Docker sandboxes while the analysis progresses.</p>
                    </article>
                    <article className="hero-stage__step">
                      <span className="hero-stage__step-label">03 Review the report</span>
                      <p>Share normalized parity sections, findings, and export-ready artifacts with the team.</p>
                    </article>
                  </div>
                </div>
                <div className="hero-metrics">
                  <article className="hero-metric">
                    <span className="hero-metric__eyebrow">Hosted plans</span>
                    <span className="hero-metric__value">Free + Pro</span>
                    <span className="hero-metric__label">Managed SaaS access for public, private, and uploaded Git repos</span>
                  </article>
                  <article className="hero-metric hero-metric--commercial">
                    <span className="hero-metric__eyebrow">Commercial path</span>
                    <span className="hero-metric__value">Company rights</span>
                    <span className="hero-metric__label">Codebase rights, self-hosting, and procurement-friendly licensing</span>
                  </article>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Why teams use SpecLens</p>
              <h2 className="text-balance">A hosted analysis surface designed for reviewability, not just raw output.</h2>
            </div>
            <p className="section-copy">
              The current product path in `docs/` centers on hosted workspaces, queued execution, parity-oriented reports,
              and a cleaner separation between SaaS access and codebase licensing.
            </p>
          </div>
          <div className="feature-grid">
            <article className="panel">
              <span className="tag tag--neutral">Review clarity</span>
              <h3>See the repository before you touch it</h3>
              <p>
                SpecLens turns source trees, manifests, runtime behavior, and job output into a structured story your team
                can act on.
              </p>
            </article>
            <article className="panel">
              <span className="tag tag--success">Hosted access</span>
              <h3>Private repos without local setup debt</h3>
              <p>
                Pro users connect private GitHub repositories through the GitHub App path and run analysis inside hosted
                sandbox workers.
              </p>
            </article>
            <article className="panel">
              <span className="tag tag--warning">Licensing clarity</span>
              <h3>Commercial rights are explicit</h3>
              <p>
                Free and Pro define service usage. Commercial agreements handle company rights for the codebase and
                self-hosted deployments.
              </p>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">What the experience feels like</p>
              <h2 className="text-balance">One product language from landing page to queue, logs, and report.</h2>
            </div>
            <p className="section-copy">
              The hosted surface covers the full journey: workspace setup, source intake, durable job execution, live log
              review, and report interpretation.
            </p>
          </div>
          <div className="feature-grid">
            <article className="timeline-card">
              <span className="tag tag--info">Portal</span>
              <h3>Shared workspaces</h3>
              <p>Organize repositories, team members, and billing state in one control surface.</p>
            </article>
            <article className="timeline-card">
              <span className="tag tag--neutral">Runner plane</span>
              <h3>Live sandbox logs</h3>
              <p>Follow queued jobs in terminal-style views instead of waiting for a black-box result.</p>
            </article>
            <article className="timeline-card">
              <span className="tag tag--success">Report view</span>
              <h3>Normalized findings</h3>
              <p>Review parity sections, severity-tagged findings, and downloadable artifacts without context switching.</p>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Plans</p>
              <h2>Hosted SaaS plans and commercial licensing</h2>
            </div>
            <p className="section-copy">
              The managed SaaS is self-serve for individuals and teams. Commercial code licensing is a separate, direct
              path for organizations that need broader rights.
            </p>
          </div>
          <div className="pricing-grid">
            <PricingCard
              name="Free"
              price="$0"
              description="For public GitHub repositories and early exploration."
              bullets={[
                "Analyze public GitHub repos only",
                "Shared workspace portal",
                "Hosted log stream and report view",
                "No private repos or Git repo archive uploads",
              ]}
              cta={<Link className="button-ghost" href="/api/auth/login">Start free</Link>}
            />
            <div className="pricing-card--featured">
              <PricingCard
                name="Pro"
                price="$19.99 / ~200 NOK"
                description="For private repositories, Git repo archive uploads, and continuous hosted use."
                bullets={[
                  "Everything in Free",
                  "Private GitHub repos through GitHub App access",
                  "ZIP/TAR Git repository uploads",
                  "Shared workspaces with owner/member access",
                ]}
                cta={<Link className="button" href="/pricing">Subscribe to Pro</Link>}
              />
            </div>
            <PricingCard
              name="Commercial"
              price="Contact us"
              description="For companies that need commercial licensing or self-hosted rights."
              bullets={[
                "Commercial rights for company usage of the codebase",
                "Separate self-hosted and licensing discussions",
                "Procurement-friendly commercial agreement path",
                "Direct contact for tailored terms",
              ]}
              cta={<Link className="button-secondary" href="/commercial">Talk commercial licensing</Link>}
            />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
