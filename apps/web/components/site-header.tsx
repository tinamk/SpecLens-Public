"use client";

import Link from "next/link";
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
          </div>
        </div>
      </div>
    </header>
  );
}
