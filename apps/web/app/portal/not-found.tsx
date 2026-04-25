import Link from "next/link";
import { PortalStateView } from "@speclens/ui";

export default function PortalNotFoundPage() {
  return (
    <PortalStateView
      eyebrow="Portal 404"
      title="This portal page is not available."
      lede="The workspace, run, or report may have moved, expired, or be outside your account access."
      pageTestId="portal-not-found-page"
      badgeLabel="Not found"
      badgeClassName="tag tag--warning"
      noticeTitle="Return to a known portal entry point"
      description="Start from the workspace directory, then reopen the source, run, or report from the current list."
      actions={<Link className="button-secondary" href="/portal/workspaces">Back to workspaces</Link>}
    />
  );
}
