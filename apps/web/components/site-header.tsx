"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeSwitcher } from "@speclens/ui";
import { usePathname } from "next/navigation";

const PUBLIC_NAV_ITEMS = [
  { href: "/pricing", label: "Pricing", testId: "public-nav-pricing" },
  { href: "/license", label: "License model", testId: "public-nav-license" },
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
        <Link className="site-header__brand" data-testid="public-nav-home" href="/">
          <span className="logo-mark" aria-hidden="true">SL</span>
          <span>
            <span className="brand-name">SpecLens</span>
          </span>
        </Link>

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
          <Link className="button-ghost" data-testid="public-cta-login" href="/api/auth/login">Log in</Link>
          <Link className="button" data-testid="public-cta-start-pro" href="/pricing">See hosted plans</Link>
          <button
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

      <div aria-hidden={!open} className="site-header__drawer" role="menu">
        {PUBLIC_NAV_ITEMS.map(item => (
          <Link
            aria-current={pathname === item.href ? "page" : undefined}
            href={item.href}
            key={item.href}
            role="menuitem"
          >
            {item.label}
          </Link>
        ))}
        <span className="site-header__drawer-divider" />
        <Link className="button-ghost" href="/api/auth/login" role="menuitem">Log in</Link>
        <Link className="button" href="/pricing" role="menuitem">See hosted plans</Link>
      </div>
    </header>
  );
}
