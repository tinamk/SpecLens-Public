"use client";

import Link from "next/link";
import { BrandLockup } from "@speclens/ui";

export function SiteFooter() {
  return (
    <footer className="site-footer" data-testid="public-site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__lead">
          <div className="site-footer__copy">
            <BrandLockup />
            <p>
              Specification-driven QA for repositories under active change. Run packs, trace execution, ship with evidence.
            </p>
            <div className="site-footer__cta">
              <Link className="button" data-testid="public-footer-pricing-cta" href="/pricing">See hosted plans</Link>
              <Link className="button-ghost" data-testid="public-footer-portal-cta" href="/login">Open hosted portal</Link>
            </div>
          </div>
        </div>

        <div className="site-footer__grid">
          <nav aria-label="Hosted product" className="site-footer__column">
            <h2 className="site-footer__heading">Hosted product</h2>
            <div className="site-footer__links">
              <Link data-testid="public-footer-pricing" href="/pricing">Pricing</Link>
              <Link data-testid="public-footer-portal" href="/login">Open hosted portal</Link>
            </div>
          </nav>
          <nav aria-label="License and rights" className="site-footer__column">
            <h2 className="site-footer__heading">License &amp; rights</h2>
            <div className="site-footer__links">
              <Link data-testid="public-footer-license" href="/license">Dual licensing</Link>
              <Link data-testid="public-footer-commercial" href="/commercial">Commercial licensing</Link>
            </div>
          </nav>
          <nav aria-label="Trust and policy" className="site-footer__column">
            <h2 className="site-footer__heading">Trust &amp; policy</h2>
            <div className="site-footer__links">
              <Link data-testid="public-footer-terms" href="/terms">Terms</Link>
              <Link data-testid="public-footer-privacy" href="/privacy">Privacy</Link>
            </div>
          </nav>
        </div>

        <div className="site-footer__bottom">
          <span>&copy; {new Date().getFullYear()} SpecLens. All rights reserved.</span>
          <span>Built for specification-driven QA.</span>
        </div>
      </div>
    </footer>
  );
}
