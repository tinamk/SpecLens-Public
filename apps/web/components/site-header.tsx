import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/">
        <strong>SpecLens</strong>
      </Link>
      <nav className="nav-links">
        <Link href="/pricing">Pricing</Link>
        <Link href="/license">License</Link>
        <Link href="/commercial">Commercial</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link className="button-ghost" href="/api/auth/login">Log in</Link>
        <Link className="button" href="/pricing">Start Pro</Link>
      </nav>
    </header>
  );
}
