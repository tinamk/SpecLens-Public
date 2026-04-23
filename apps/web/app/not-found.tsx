import Link from "next/link";
import { MarketingShell } from "@speclens/ui";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export default function NotFoundPage() {
  return (
    <MarketingShell testId="public-not-found-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-not-found-main">
        <section className="status-hero" data-testid="public-not-found-hero">
          <p className="eyebrow">404</p>
          <h1 className="text-balance">We could not find that page.</h1>
          <p className="hero-lede">
            The link might be broken, or the page has moved. Head back to the hosted product or the commercial
            licensing routes.
          </p>
          <div className="hero__actions">
            <Link className="button" href="/">Back to home</Link>
            <Link className="button-secondary" href="/pricing">See hosted plans</Link>
            <Link className="button-ghost" href="/commercial">Talk commercial</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </MarketingShell>
  );
}
