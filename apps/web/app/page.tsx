import Link from "next/link";
import {
  MarketingRoutePanel,
  MarketingRouteSplit,
  MarketingSectionHeading,
  MarketingShell,
  PricingCard,
} from "@speclens/ui";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export default function HomePage() {
  return (
    <MarketingShell testId="public-home-page">
      <SiteHeader />
      <main data-testid="public-home-main">
        <section className="hero" data-testid="public-home-hero">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">Hosted repo analysis</p>
              <p className="hero__brand">SpecLens</p>
              <h1 className="text-balance">See what a repository does before your team inherits it.</h1>
              <p className="hero-lede">
                SpecLens turns source access, queued runs, live logs, and reports into one reviewable workspace so teams can
                understand unfamiliar code without guessing.
              </p>
              <div className="hero__actions">
                <Link className="button" data-testid="public-home-start-hosted" href="/api/auth/login">Try hosted SaaS</Link>
                <Link className="button-ghost" data-testid="public-home-view-pricing" href="/pricing">See hosted pricing</Link>
              </div>
              <p className="hero-proofline">
                Public GitHub, private GitHub, Git repo uploads, report exports, and remediation runs in one hosted flow.
              </p>
            </div>

            <div className="hero-stage">
              <div className="hero-atlas" aria-hidden="true">
                <div className="hero-atlas__eyebrow">Review route</div>
                <div className="hero-atlas__line" />
                <div className="hero-atlas__row">
                  <div className="hero-atlas__node">
                    <span className="hero-atlas__node-index">01</span>
                    <strong>Bring in a repo</strong>
                    <p>Connect public Git, private GitHub, or a clean archive upload.</p>
                  </div>
                  <div className="hero-atlas__node hero-atlas__node--accent">
                    <span className="hero-atlas__node-index">02</span>
                    <strong>Watch the run</strong>
                    <p>Track durable logs from isolated workers while the analysis executes.</p>
                  </div>
                </div>
                <div className="hero-atlas__row">
                  <div className="hero-atlas__metric">
                    <span>Surface</span>
                    <strong>Portal + reports</strong>
                  </div>
                  <div className="hero-atlas__metric">
                    <span>Decision model</span>
                    <strong>Hosted vs commercial</strong>
                  </div>
                </div>
                <div className="hero-atlas__result">
                  <span className="hero-atlas__result-label">03 Read the output</span>
                  <p>Open normalized findings, release-gate state, and exportable artifacts without leaving the review flow.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <MarketingRouteSplit testId="public-home-decision-banner">
          <MarketingRoutePanel
            badgeLabel="Hosted SaaS"
            badgeClassName="tag tag--success"
            description="Free covers public GitHub repos. Pro adds private repositories, Git repo uploads, and shared workspace access inside SpecLens Cloud."
            title="Choose hosted SaaS for the managed product."
            actions={
              <>
              <Link className="button" data-testid="public-home-start-hosted-secondary" href="/api/auth/login">Start hosted</Link>
              <Link className="button-ghost" href="/pricing">Compare plans</Link>
              </>
            }
          />
          <MarketingRoutePanel
            badgeLabel="Commercial licensing"
            badgeClassName="tag tag--warning"
            description="Contact us if you need self-hosting, codebase rights, procurement review, or a licensing path beyond the managed service."
            title="Choose commercial licensing for company rights."
            tone="commercial"
            actions={
              <>
              <Link className="button-secondary" data-testid="public-home-contact-commercial" href="/commercial">
                Talk commercial licensing
              </Link>
              </>
            }
          />
        </MarketingRouteSplit>

        <section className="section">
          <MarketingSectionHeading
            kicker="Why teams use SpecLens"
            title="A clearer path from source intake to a usable review."
            copy="The product is built for teams inheriting real repositories, not for generic code summaries. Every major step stays visible and reviewable."
          />
          <div className="feature-grid">
            <article className="panel">
              <span className="tag tag--neutral">Source clarity</span>
              <h3>Know what you are analyzing</h3>
              <p>Public Git, private GitHub installs, and Git repo uploads stay explicit so reviews stay source-correct.</p>
            </article>
            <article className="panel">
              <span className="tag tag--info">Run visibility</span>
              <h3>Watch progress instead of waiting blind</h3>
              <p>Queued execution, live logs, and artifacts make the run behavior legible while work is still in motion.</p>
            </article>
            <article className="panel">
              <span className="tag tag--success">Report structure</span>
              <h3>Read findings in a stable frame</h3>
              <p>Sections, findings, release gates, and remediation state are organized for handoff, not just inspection.</p>
            </article>
          </div>
        </section>

        <section className="section">
          <MarketingSectionHeading
            kicker="How the hosted flow works"
            title="One path, three review moments, no hidden jumps."
            copy="The experience is intentionally linear: define the source, inspect the run, then review the evidence and next steps."
          />
          <div className="feature-grid">
            <article className="timeline-card">
              <span className="tag tag--neutral">01 Intake</span>
              <h3>Connect the right repository</h3>
              <p>Bring in the exact Git-backed source you want to analyze and keep companion-source context explicit.</p>
            </article>
            <article className="timeline-card">
              <span className="tag tag--warning">02 Execution</span>
              <h3>Follow the run live</h3>
              <p>Use durable logs and terminal-style views to understand what the hosted worker is actually doing.</p>
            </article>
            <article className="timeline-card">
              <span className="tag tag--success">03 Review</span>
              <h3>Open findings and remediation</h3>
              <p>Move from report sections to code review and queued remediation without rebuilding the context by hand.</p>
            </article>
          </div>
        </section>

        <section className="section">
          <MarketingSectionHeading
            kicker="Plans"
            title="Hosted SaaS plans and commercial licensing"
            copy="Hosted access and codebase rights are different decisions. The product keeps that split visible on purpose."
          />
          <div className="pricing-grid">
            <PricingCard
              name="Free"
              price="$0"
              description="For public GitHub repositories and early evaluation."
              bullets={[
                "Analyze public GitHub repos",
                "Create shared workspaces",
                "Read hosted logs and reports",
                "No private repos or uploads",
              ]}
              cta={<Link className="button-ghost" href="/api/auth/login">Start free</Link>}
            />
            <div className="pricing-card--featured">
              <PricingCard
                name="Pro"
                price="$19.99 / ~200 NOK"
                description="For private repositories, Git repo uploads, and ongoing hosted use."
                bullets={[
                  "Everything in Free",
                  "Private GitHub repos",
                  "ZIP/TAR Git repo uploads",
                  "Shared owner and member access",
                ]}
                cta={<Link className="button" href="/pricing">See Pro details</Link>}
              />
            </div>
            <PricingCard
              name="Commercial"
              price="Contact us"
              description="For companies that need codebase rights or self-hosted discussions."
              bullets={[
                "Commercial rights for company usage",
                "Self-hosting and procurement review",
                "Tailored contract path",
                "Direct contact for next steps",
              ]}
              cta={<Link className="button-secondary" href="/commercial">Talk commercial licensing</Link>}
            />
          </div>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
