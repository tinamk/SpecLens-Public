"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLockup, ThemeSwitcher } from "@speclens/ui";
import { usePathname } from "next/navigation";

const PUBLIC_NAV_ITEMS = [
  { href: "/pricing", label: "Pricing", testId: "public-nav-pricing" },
  { href: "/license", label: "Dual licensing", testId: "public-nav-license" },
  { href: "/commercial", label: "Commercial licensing", testId: "public-nav-commercial" },
  { href: "/terms", label: "Terms", testId: "public-nav-terms" },
  { href: "/privacy", label: "Privacy", testId: "public-nav-privacy" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header
      className={`site-header ${open ? "site-header--open" : ""}`}
      data-testid="public-site-header"
    >
      <div className="site-header__bar">
        <BrandLockup testId="public-nav-home" />

        <nav className="site-header__nav" aria-label="Primary">
          {PUBLIC_NAV_ITEMS.map(item => (
            <Link
              aria-current={pathname === item.href ? "page" : undefined}
              data-testid={item.testId}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="site-header__actions">
          <ThemeSwitcher compact />
          <Link className="button-secondary" data-testid="public-cta-login" href="/login">Log in</Link>
          <Link className="button" data-testid="public-cta-start-pro" href="/pricing">See hosted plans</Link>
          <button
            aria-controls="public-mobile-nav"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="site-header__menu-toggle"
            onClick={() => setOpen(v => !v)}
            type="button"
          >
            {open ? (
              <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            ) : (
              <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <nav aria-label="Mobile primary" className="site-header__drawer" hidden={!open} id="public-mobile-nav">
        {PUBLIC_NAV_ITEMS.map(item => (
          <Link
            aria-current={pathname === item.href ? "page" : undefined}
            data-testid={`${item.testId}-mobile`}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
        <span className="site-header__drawer-divider" />
        <Link className="button-secondary" data-testid="public-cta-login-mobile" href="/login">Log in</Link>
        <Link className="button" data-testid="public-cta-start-pro-mobile" href="/pricing">See hosted plans</Link>
      </nav>
    </header>
  );
}
