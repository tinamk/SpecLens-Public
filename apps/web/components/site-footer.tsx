import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer" data-testid="public-site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__grid">
          <div>
            <p className="eyebrow">Hosted SaaS and dual licensing</p>
            <h2>SpecLens</h2>
            <p>
              Free and Pro cover the managed hosted service. Commercial licensing handles company usage of the codebase,
              self-hosting rights, and procurement-oriented agreements.
            </p>
          </div>
          <div className="site-footer__links">
            <Link data-testid="public-footer-pricing" href="/pricing">Pricing</Link>
            <Link data-testid="public-footer-license" href="/license">License model</Link>
            <Link data-testid="public-footer-commercial" href="/commercial">Commercial contact</Link>
            <Link data-testid="public-footer-terms" href="/terms">Terms</Link>
            <Link data-testid="public-footer-privacy" href="/privacy">Privacy</Link>
            <Link data-testid="public-footer-portal" href="/portal/workspaces">Portal</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
