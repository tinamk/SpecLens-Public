import Link from "next/link";
import { PublicRouteState } from "../components/public-route-state";

export default function Loading() {
  return (
    <PublicRouteState
      actions={<Link className="button-ghost" href="/">Return to public home</Link>}
      description="The public shell stays available while this route loads."
      eyebrow="Loading"
      heroTestId="public-route-loading-hero"
      isLoading
      mainTestId="public-route-loading"
      testId="public-route-loading-page"
      title="Preparing the next SpecLens view."
    />
  );
}
