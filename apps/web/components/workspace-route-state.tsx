import type { Route } from "next";
import Link from "next/link";
import { PortalStateView } from "@speclens/ui";
import { buildPortalPrimaryNav } from "../lib/portal";

export function WorkspaceRouteState({
  activePrimaryNavKey = "workspaces",
  backHref = "/portal/workspaces",
  backLabel = "Back to workspaces",
  deniedDescription = "You do not have access to this workspace.",
  deniedNoticeTitle = "Access denied",
  deniedTitle = "Access denied",
  descriptionTestId,
  eyebrow,
  isAdmin,
  isMissing,
  missingDescription = "This workspace could not be found, or the route points at an environment where it does not exist.",
  missingNoticeTitle,
  missingTitle = "Workspace not found",
  pageTestId,
}: {
  activePrimaryNavKey?: string;
  backHref?: Route | string;
  backLabel?: string;
  deniedDescription?: string;
  deniedNoticeTitle?: string;
  deniedTitle?: string;
  descriptionTestId: string;
  eyebrow: string;
  isAdmin: boolean;
  isMissing: boolean;
  missingDescription?: string;
  missingNoticeTitle?: string;
  missingTitle?: string;
  pageTestId: string;
}) {
  return (
    <PortalStateView
      eyebrow={eyebrow}
      title={isMissing ? missingTitle : deniedTitle}
      pageTestId={pageTestId}
      primaryNav={buildPortalPrimaryNav(isAdmin)}
      activePrimaryNavKey={activePrimaryNavKey}
      actions={<Link className="button-secondary" href={backHref as Route}>{backLabel}</Link>}
      description={isMissing ? missingDescription : deniedDescription}
      descriptionTestId={descriptionTestId}
      noticeTitle={isMissing ? missingNoticeTitle ?? missingTitle : deniedNoticeTitle}
    />
  );
}
