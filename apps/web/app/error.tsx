"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="marketing-shell" data-testid="public-error-page">
      <main className="legal-layout" data-testid="public-error-main">
        <section className="status-hero" data-testid="public-error-hero">
          <p className="eyebrow">Something broke</p>
          <h1 className="text-balance">Unexpected error on this page.</h1>
          <p className="hero-lede">
            The page failed to render. Try again, or return to the hosted product. If this keeps happening, reach
            out on the commercial licensing path.
          </p>
          {error.digest ? (
            <p className="subtle-note" data-testid="public-error-digest">
              Reference: <strong>{error.digest}</strong>
            </p>
          ) : null}
          <div className="hero__actions">
            <button className="button" onClick={reset} type="button">Try again</button>
            <Link className="button-secondary" href="/">Back to home</Link>
            <Link className="button-ghost" href="/commercial">Talk commercial</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
