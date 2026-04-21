import type { Route } from "next";
import type { JobStatus } from "@speclens/contracts";
import type { PortalNavItem } from "@speclens/ui";
import {
  getGithubRepositories,
  getPortalAnalysisTasks,
  getWorkspaceConsole,
  getWorkspaceSecrets,
  type PortalAnalysisTask,
} from "./api";

export function getEntitlementTagClass(entitlement: string): string {
  if (entitlement === "commercial") return "tag tag--warning";
  if (entitlement === "pro") return "tag tag--success";
  return "tag tag--neutral";
}

export function formatSourceType(type: string): string {
  if (type === "git-public") return "public git repo";
  if (type === "github-private") return "private GitHub repo";
  if (type === "upload-archive") return "git repo archive upload";
  return type;
}

export function formatJobLabel(
  job: { executionPath?: string; agentId?: string | null },
  tasks: PortalAnalysisTask[],
): string {
  if (job.agentId) {
    return tasks.find(task => task.agentId === job.agentId)?.title ?? job.agentId;
  }
  return "Agent analysis run";
}

export function formatJobExecutionMode(_job: { executionPath?: string; agentId?: string | null }): string {
  void _job;
  return "Unified agent runtime";
}

export function getWorkspaceReportHref(workspaceId: string, reportId?: string | null): Route | null {
  if (!reportId) {
    return null;
  }
  return `/portal/workspaces/${workspaceId}/reports/${reportId}` as Route;
}

export function getWorkspaceRunHref(workspaceId: string, jobId?: string | null): Route | null {
  if (!jobId) {
    return null;
  }
  return `/portal/workspaces/${workspaceId}/runs/${jobId}` as Route;
}

export function getWorkspaceReportsEmptyState(query: string): { title: string; detail: string } {
  const normalizedQuery = query.trim();
  if (normalizedQuery) {
    return {
      title: "No reports matched this filter.",
      detail: `Try a different title, source, or status search for “${normalizedQuery}”, or open the runs view to inspect jobs that have not produced report output yet.`,
    };
  }
  return {
    title: "No reports available yet.",
    detail: "Completed runs with durable report output will appear here. Open the runs view to inspect in-progress jobs, logs, and artifacts while you wait.",
  };
}

export function getWorkspaceReportSectionsEmptyState(input: {
  totalFindings: number;
}): { title: string; detail: string } {
  if (input.totalFindings > 0) {
    return {
      title: "Normalized sections are not available for this report yet.",
      detail: "Review the findings below and open the job or artifacts if you need the raw execution evidence before section rendering is available.",
    };
  }
  return {
    title: "No normalized sections were generated for this report.",
    detail: "Open the job or artifact history if you need to confirm whether the run produced an intentionally empty report or stopped before section output was written.",
  };
}

export function getWorkspaceReportFindingsEmptyStateTagClass(releaseGateStatus?: string | null): string {
  if (releaseGateStatus === "fail") {
    return "tag tag--danger";
  }
  if (releaseGateStatus === "warn") {
    return "tag tag--warning";
  }
  if (releaseGateStatus === "pass") {
    return "tag tag--success";
  }
  return "tag tag--neutral";
}

export function getWorkspaceReportFindingsEmptyState(input: {
  releaseGateStatus?: string | null;
  sectionsCount: number;
}): { title: string; detail: string } {
  if (input.releaseGateStatus === "pass") {
    return {
      title: "No findings were recorded in this report.",
      detail: "The release gate is currently passing. Review the sections and artifacts if you need the supporting execution evidence for this clean result.",
    };
  }
  if ((input.releaseGateStatus === "warn" || input.releaseGateStatus === "fail") && input.sectionsCount > 0) {
    return {
      title: "No findings were extracted, but the release gate still needs review.",
      detail: `The release gate is currently ${input.releaseGateStatus === "warn" ? "warning" : "failing"}. Review the normalized sections, job logs, and artifacts to confirm what evidence was captured before treating this report as clean.`,
    };
  }
  if (input.sectionsCount > 0) {
    return {
      title: "No findings were extracted from the available report sections.",
      detail: "Review the normalized sections above and the run artifacts below if you need to understand what the analysis covered or where evidence was captured.",
    };
  }
  return {
    title: "This report does not contain any findings yet.",
    detail: "Open the job and artifact history to confirm whether the run finished with no actionable issues or stopped before finding output was generated.",
  };
}

export function getWorkspaceReportRemediationCodeHref(input: {
  workspaceId: string;
  sourceId: string;
  reportId: string;
  filePath: string;
  branchName?: string | null;
  baseRef?: string | null;
}): Route {
  const params = new URLSearchParams({
    sourceId: input.sourceId,
    path: input.filePath,
    reportId: input.reportId,
  });
  if (input.branchName) {
    params.set("ref", input.branchName);
    params.set("compare", input.baseRef && input.baseRef.trim().length > 0 ? input.baseRef : "HEAD");
  }
  return `/portal/workspaces/${input.workspaceId}/code?${params.toString()}` as Route;
}

export function getWorkspaceReportRemediationSummary(input: {
  changesetGenerated: boolean;
  latestRemediationJobId?: string | null;
  latestRemediationJobStatus?: JobStatus | null;
}): {
  tagClass: string;
  title: string;
  detail: string;
  canOpenRun: boolean;
} {
  if (input.changesetGenerated) {
    return {
      tagClass: "tag tag--success",
      title: "Remediation changeset ready",
      detail: "SpecLens has already generated reviewable remediation output for this report. Open the remediation run if you need the underlying logs or artifacts.",
      canOpenRun: Boolean(input.latestRemediationJobId),
    };
  }

  if (!input.latestRemediationJobId) {
    return {
      tagClass: "tag tag--neutral",
      title: "No remediation changeset has been generated for this report yet.",
      detail: "Launch remediation from this report when you want SpecLens to prepare a queued fix run and produce reviewable changeset output.",
      canOpenRun: false,
    };
  }

  if (input.latestRemediationJobStatus === "pending" || input.latestRemediationJobStatus === "queued") {
    return {
      tagClass: "tag tag--warning",
      title: "Remediation run queued",
      detail: "A remediation run has already been queued for this report. Open the remediation run to follow progress, logs, and artifacts before a changeset is ready.",
      canOpenRun: true,
    };
  }

  if (input.latestRemediationJobStatus === "running") {
    return {
      tagClass: "tag tag--warning",
      title: "Remediation run in progress",
      detail: "SpecLens is still preparing remediation output for this report. Open the remediation run to follow progress, logs, and artifacts before a changeset is ready.",
      canOpenRun: true,
    };
  }

  if (input.latestRemediationJobStatus === "failed" || input.latestRemediationJobStatus === "cancelled") {
    return {
      tagClass: input.latestRemediationJobStatus === "failed" ? "tag tag--danger" : "tag tag--neutral",
      title: "Latest remediation run needs review",
      detail: "The latest remediation run did not finish cleanly, so no changeset is available yet. Open the remediation run to inspect logs and artifacts before retrying.",
      canOpenRun: true,
    };
  }

  return {
    tagClass: "tag tag--neutral",
    title: "Latest remediation run finished without a changeset",
    detail: "The remediation run completed, but there is no reviewable changeset yet. Open the remediation run to inspect logs and artifacts before deciding whether to retry.",
    canOpenRun: true,
  };
}

export function isWorkspaceScopedReportContext(
  workspaceId: string,
  ...scopedEntities: Array<{ workspaceId: string } | null | undefined>
): boolean {
  return scopedEntities.every(entity => !entity || entity.workspaceId === workspaceId);
}

export function isWorkspaceScopedJobContext(
  workspaceId: string,
  ...scopedEntities: Array<{ workspaceId: string } | null | undefined>
): boolean {
  return scopedEntities.every(entity => !entity || entity.workspaceId === workspaceId);
}

export function isWorkspaceScopedCodeReviewContext(
  workspaceId: string,
  review: { workspaceId: string; source: { id: string } },
  workspaceSources: Array<{ id: string }>,
): boolean {
  if (review.workspaceId !== workspaceId) {
    return false;
  }
  return workspaceSources.some(source => source.id === review.source.id);
}

export function isWorkspaceScopedWorkspaceConsoleContext(
  workspaceId: string,
  workspaceConsole: {
    workspace: { id: string };
    members: Array<{ workspaceId: string }>;
    sources: Array<{ workspaceId: string }>;
    installations: Array<{ workspaceId: string }>;
    jobs: Array<{ job: { workspaceId: string }; report?: { workspaceId: string } | null }>;
  },
): boolean {
  if (workspaceConsole.workspace.id !== workspaceId) {
    return false;
  }
  return [
    ...workspaceConsole.members,
    ...workspaceConsole.sources,
    ...workspaceConsole.installations,
    ...workspaceConsole.jobs.flatMap(envelope => [envelope.job, envelope.report].filter(Boolean) as Array<{ workspaceId: string }>),
  ].every(entity => entity.workspaceId === workspaceId);
}

export function buildPortalPrimaryNav(isAdmin: boolean): PortalNavItem[] {
  const items: PortalNavItem[] = [
    {
      key: "workspaces",
      href: "/portal/workspaces",
      label: "Workspaces",
    },
    {
      key: "settings",
      href: "/portal/settings",
      label: "Settings",
    },
  ];
  if (isAdmin) {
    items.push({
      key: "admin",
      href: "/portal/admin/ai/auth",
      label: "Admin",
    });
  }
  items.push(
    {
      key: "pricing",
      href: "/pricing",
      label: "Pricing",
    },
    {
      key: "commercial",
      href: "/commercial",
      label: "Commercial",
    },
  );
  return items;
}

export function buildWorkspaceNav(workspaceId: string): PortalNavItem[] {
  return [
    {
      key: "overview",
      href: `/portal/workspaces/${workspaceId}`,
      label: "Overview",
    },
    {
      key: "sources",
      href: `/portal/workspaces/${workspaceId}/sources`,
      label: "Sources",
    },
    {
      key: "code",
      href: `/portal/workspaces/${workspaceId}/code`,
      label: "Code",
    },
    {
      key: "runs",
      href: `/portal/workspaces/${workspaceId}/runs`,
      label: "Runs",
    },
    {
      key: "reports",
      href: `/portal/workspaces/${workspaceId}/reports`,
      label: "Reports",
    },
    {
      key: "access",
      href: `/portal/workspaces/${workspaceId}/access`,
      label: "Access",
    },
    {
      key: "settings",
      href: `/portal/workspaces/${workspaceId}/settings`,
      label: "Settings",
    },
  ];
}

export function buildAdminNav(): PortalNavItem[] {
  return [
    {
      key: "auth",
      href: "/portal/admin/ai/auth",
      label: "Auth",
    },
    {
      key: "skills",
      href: "/portal/admin/ai/skills",
      label: "Skills",
    },
    {
      key: "roles",
      href: "/portal/admin/ai/roles",
      label: "Roles",
    },
    {
      key: "agents",
      href: "/portal/admin/ai/agents",
      label: "Agents",
    },
  ];
}

export async function getWorkspacePageData(workspaceId: string) {
  const [workspaceConsole, tasks, secrets] = await Promise.all([
    getWorkspaceConsole(workspaceId),
    getPortalAnalysisTasks(),
    getWorkspaceSecrets(workspaceId),
  ]);
  const githubRepositories = workspaceConsole.installations.length > 0
    ? await getGithubRepositories(workspaceId)
    : [];

  return {
    workspaceConsole,
    tasks,
    secrets,
    githubRepositories,
  };
}
