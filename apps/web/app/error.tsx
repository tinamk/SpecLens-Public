"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PublicRouteState } from "../components/public-route-state";

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
    <PublicRouteState
      actions={(
        <>
          <button className="button" onClick={reset} type="button">Try again</button>
          <Link className="button-secondary" href="/">Back to home</Link>
          <Link className="button-ghost" href="/pricing">See hosted plans</Link>
        </>
      )}
      description="The page failed to render. Try again first, then return to the hosted product if the issue persists."
      eyebrow="Something broke"
      heroTestId="public-error-hero"
      mainTestId="public-error-main"
      testId="public-error-page"
      title="Unexpected error on this page."
    >
      {error.digest ? (
        <p className="subtle-note" data-testid="public-error-digest">
          Reference: <strong>{error.digest}</strong>
        </p>
      ) : null}
    </PublicRouteState>
  );
}
