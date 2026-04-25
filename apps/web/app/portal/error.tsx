"use client";

import Link from "next/link";
import { PortalStateView } from "@speclens/ui";

export default function PortalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PortalStateView
      eyebrow="Portal recovery"
      title="Portal data did not load cleanly."
      lede="Retry from the server state first. If the problem persists, return to the workspace directory and open the specific run or report again."
      pageTestId="portal-error-page"
      badgeLabel="Portal error"
      badgeClassName="tag tag--danger"
      noticeTitle="Unable to render this portal view"
      description={
        <>
          The portal view failed before it could finish rendering. Retry once, then return to the workspace directory if this route still fails.
          {error.digest ? <span className="subtle-note">Reference: {error.digest}</span> : null}
        </>
      }
      noticeRole="alert"
      actions={
        <>
          <button className="button" type="button" onClick={reset}>Retry</button>
          <Link className="button-secondary" href="/portal/workspaces">Back to workspaces</Link>
        </>
      }
    />
  );
}
