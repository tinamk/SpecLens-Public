import Link from "next/link";
import { PricingCard } from "@speclens/ui";
import { SiteHeader } from "../components/site-header";

export default function HomePage() {
  return (
    <div className="marketing-shell">
      <SiteHeader />

      <section className="hero">
        <div className="hero-card">
          <div className="hero-grid">
            <div>
              <p className="eyebrow">Spec-driven repository intelligence</p>
              <h1>Stop guessing what a repo is doing. See its risks, story, and next moves in one run.</h1>
              <p>
                SpecLens turns repositories into reviewable, auditable narratives. Hosted SaaS plans for public and private
                repos. Commercial licensing for companies that want self-hosted or broader commercial rights.
              </p>
              <div className="nav-links">
                <Link className="button" href="/pricing">Compare plans</Link>
                <Link className="button-secondary" href="/api/auth/login">Log in with Keycloak</Link>
              </div>
            </div>
            <div className="panel">
              <span className="tag">Why teams use SpecLens</span>
              <ul className="bullet-list">
                <li>Captures live analysis logs like a GitHub Actions job, but focused on repo understanding.</li>
                <li>Runs code analysis in isolated Docker sandboxes.</li>
                <li>Stores artifacts in S3-compatible object storage and renders polished review reports.</li>
                <li>Supports shared workspaces, public repo review, and paid private-repo analysis.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="feature-grid">
          <article className="panel">
            <h2>See the repo before you touch it</h2>
            <p>
              SpecLens turns source trees, manifests, and hosted job output into a structured report your team can actually use.
            </p>
          </article>
          <article className="panel">
            <h2>Private repos without fragile local setup</h2>
            <p>
              Pro users connect private GitHub repositories through a GitHub App and run analysis in hosted sandbox workers.
            </p>
          </article>
          <article className="panel">
            <h2>Commercial rights are explicit</h2>
            <p>
              The codebase is dual licensed: source-available and non-commercial by default, with separate commercial terms for companies.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        <h2>Hosted SaaS plans and commercial licensing</h2>
        <div className="pricing-grid">
          <PricingCard
            name="Free"
            price="$0"
            description="For public GitHub repositories and early exploration."
            bullets={[
              "Analyze public GitHub repos only",
              "Shared workspace portal",
              "Hosted log stream and report view",
              "No private repos or archive uploads",
            ]}
            cta={<Link className="button-ghost" href="/api/auth/login">Start free</Link>}
          />
          <div className="pricing-card pricing-card--featured">
            <PricingCard
              name="Pro"
              price="$19.99 / ~200 NOK"
              description="For private repositories, uploads, and continuous hosted use."
              bullets={[
                "Everything in Free",
                "Private GitHub repos through GitHub App access",
                "ZIP/TAR codebase uploads",
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

      <footer className="site-footer">
        <p>SpecLens is hosted SaaS plus dual-licensed code. Public SaaS plans are self-serve; commercial code licensing is handled separately.</p>
      </footer>
    </div>
  );
}
