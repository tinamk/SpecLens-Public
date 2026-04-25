import Link from "next/link";
import { PublicRouteState } from "../components/public-route-state";

export default function NotFoundPage() {
  return (
    <PublicRouteState
      actions={(
        <>
          <Link className="button" href="/">Back to home</Link>
          <Link className="button-secondary" href="/pricing">See hosted plans</Link>
          <Link className="button-ghost" href="/login">Open hosted portal</Link>
        </>
      )}
      description="The link might be broken, or the page has moved. Head back to the hosted product routes."
      eyebrow="404"
      heroTestId="public-not-found-hero"
      mainTestId="public-not-found-main"
      testId="public-not-found-page"
      title="We could not find that page."
    />
  );
}
