import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer" data-testid="public-site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__lead">
          <div className="site-footer__copy">
            <p className="eyebrow">Hosted SaaS and dual licensing</p>
            <h2>SpecLens</h2>
            <p>
              Use the cloud product when you need fast repository analysis. Use the commercial path when you need company
              rights, procurement review, or a self-hosted deployment conversation.
            </p>
            <div className="site-footer__cta">
              <Link className="button" data-testid="public-footer-pricing-cta" href="/pricing">Choose a hosted path</Link>
              <Link className="button-ghost" data-testid="public-footer-portal-cta" href="/portal/workspaces">Open portal</Link>
            </div>
          </div>
          <div className="site-footer__signal-grid">
            <article className="site-footer__signal">
              <p className="site-footer__heading">Hosted path</p>
              <strong>Queue work, inspect code, and review reports from the portal.</strong>
              <p>The product route is for day-to-day repository analysis, not for procurement or contract questions.</p>
            </article>
            <article className="site-footer__signal site-footer__signal--accent">
              <p className="site-footer__heading">Commercial path</p>
              <strong>Use the commercial route when you need company rights or a deployment conversation.</strong>
              <p>Keep self-hosting, licensing, and procurement discussions explicit instead of burying them inside product pages.</p>
            </article>
          </div>
        </div>
        <div className="site-footer__grid">
          <article className="site-footer__column">
            <p className="site-footer__heading">Hosted product</p>
            <p className="site-footer__column-copy">Compare hosted plans, then move directly into the control plane.</p>
            <div className="site-footer__links">
              <Link data-testid="public-footer-pricing" href="/pricing">Pricing</Link>
              <Link data-testid="public-footer-portal" href="/portal/workspaces">Portal</Link>
            </div>
          </article>
          <article className="site-footer__column">
            <p className="site-footer__heading">License and rights</p>
            <p className="site-footer__column-copy">Keep company-rights and procurement questions separate from the hosted path.</p>
            <div className="site-footer__links">
              <Link data-testid="public-footer-license" href="/license">License model</Link>
              <Link data-testid="public-footer-commercial" href="/commercial">Commercial contact</Link>
            </div>
          </article>
          <article className="site-footer__column site-footer__column--accent">
            <p className="site-footer__heading">Trust and policy</p>
            <p className="site-footer__column-copy">Review the shared legal pages that govern the hosted experience.</p>
            <div className="site-footer__links">
              <Link data-testid="public-footer-terms" href="/terms">Terms</Link>
              <Link data-testid="public-footer-privacy" href="/privacy">Privacy</Link>
            </div>
          </article>
        </div>
      </div>
    </footer>
  );
}
