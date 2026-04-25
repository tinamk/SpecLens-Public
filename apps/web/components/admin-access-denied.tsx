import Link from "next/link";
import { PortalStateView } from "@speclens/ui";
import { buildPortalPrimaryNav } from "../lib/portal";

export function AdminAccessDenied({ pageTestId = "admin-ai-access-denied-page" }: { pageTestId?: string }) {
  return (
    <PortalStateView
      actions={<Link className="button-secondary" href="/portal/workspaces">Open workspaces</Link>}
      badgeLabel="Admin only"
      description="Administrator access is required."
      descriptionTestId="admin-ai-access-denied"
      eyebrow="Admin"
      noticeTitle="Admin only"
      pageTestId={pageTestId}
      primaryNav={buildPortalPrimaryNav(false)}
      title="Access denied"
    />
  );
}
