import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer" data-testid="public-site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__lead">
          <div className="site-footer__copy">
            <Link className="site-header__brand" href="/">
              <span className="logo-mark" aria-hidden="true">SL</span>
              <span className="brand-name">SpecLens</span>
            </Link>
            <p>
              Specification-driven QA for repositories under active change. Run packs, trace execution, ship with evidence.
            </p>
            <div className="site-footer__cta">
              <Link className="button" data-testid="public-footer-pricing-cta" href="/pricing">See hosted plans</Link>
              <Link className="button-ghost" data-testid="public-footer-portal-cta" href="/portal/workspaces">Open portal</Link>
            </div>
          </div>
        </div>

        <div className="site-footer__grid">
          <div className="site-footer__column">
            <p className="site-footer__heading">Hosted product</p>
            <div className="site-footer__links">
              <Link data-testid="public-footer-pricing" href="/pricing">Pricing</Link>
              <Link data-testid="public-footer-portal" href="/portal/workspaces">Portal</Link>
            </div>
          </div>
          <div className="site-footer__column">
            <p className="site-footer__heading">License &amp; rights</p>
            <div className="site-footer__links">
              <Link data-testid="public-footer-license" href="/license">License model</Link>
              <Link data-testid="public-footer-commercial" href="/commercial">Commercial contact</Link>
            </div>
          </div>
          <div className="site-footer__column">
            <p className="site-footer__heading">Trust &amp; policy</p>
            <div className="site-footer__links">
              <Link data-testid="public-footer-terms" href="/terms">Terms</Link>
              <Link data-testid="public-footer-privacy" href="/privacy">Privacy</Link>
            </div>
          </div>
        </div>

        <div className="site-footer__bottom">
          <span>&copy; {new Date().getFullYear()} SpecLens. All rights reserved.</span>
          <span>Built for specification-driven QA.</span>
        </div>
      </div>
    </footer>
  );
}
