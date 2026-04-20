import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header" data-testid="public-site-header">
      <div className="site-header__bar">
        <Link className="site-header__brand" data-testid="public-nav-home" href="/">
          <span className="logo-mark">SL</span>
          <span>
            <span className="brand-kicker">Hosted repo analysis</span>
            <strong className="brand-name">SpecLens</strong>
          </span>
        </Link>
        <div className="site-header__nav">
          <nav className="site-header__links" aria-label="Primary">
            <Link data-testid="public-nav-pricing" href="/pricing">Pricing</Link>
            <Link data-testid="public-nav-license" href="/license">License</Link>
            <Link data-testid="public-nav-commercial" href="/commercial">Commercial</Link>
            <Link data-testid="public-nav-terms" href="/terms">Terms</Link>
            <Link data-testid="public-nav-privacy" href="/privacy">Privacy</Link>
          </nav>
          <div className="site-header__actions">
            <Link className="button-ghost" data-testid="public-cta-login" href="/api/auth/login">Log in</Link>
            <Link className="button" data-testid="public-cta-start-pro" href="/pricing">Start Pro</Link>
          </div>
        </div>
      </div>
    </header>
  );
}
