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

type WorkspaceScopedEntityLike = { workspaceId?: string | null } | null | undefined;
type WorkspaceScopedJobEnvelopeLike = {
  job?: WorkspaceScopedEntityLike;
  report?: WorkspaceScopedEntityLike;
} | null | undefined;
type WorkspaceConsoleContextLike = {
  workspace?: { id?: string | null } | null;
  members?: WorkspaceScopedEntityLike[] | null;
  sources?: Array<({ id?: string | null } & { workspaceId?: string | null }) | null | undefined> | null;
  installations?: Array<({ githubInstallationId?: string | null } & { workspaceId?: string | null }) | null | undefined> | null;
  jobs?: WorkspaceScopedJobEnvelopeLike[] | null;
};

function isWorkspaceScopedEntityLike(
  workspaceId: string,
  entity: WorkspaceScopedEntityLike,
): boolean {
  return entity == null || entity.workspaceId === workspaceId;
}

function normalizeNonEmptyString(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractBranchNameFromPullInstruction(instruction: string): string | null {
  const trimmed = instruction.trim();
  const fetchMatch = /^git fetch \S+ (\S+)$/.exec(trimmed);
  if (fetchMatch?.[1]) {
    return fetchMatch[1];
  }
  const checkoutMatch = /^git checkout (\S+)$/.exec(trimmed);
  if (checkoutMatch?.[1]) {
    return checkoutMatch[1];
  }
  return null;
}

export function getEntitlementTagClass(entitlement: string): string {
  if (entitlement === "commercial") return "tag tag--warning";
  if (entitlement === "pro") return "tag tag--success";
  return "tag tag--neutral";
}

export function getSourceVerificationTagClass(status?: string | null): string {
  if (status === "failed") return "tag tag--danger";
  if (status === "pending") return "tag tag--warning";
  return "tag tag--success";
}

export function getJobStatusTagClass(status?: JobStatus | string | null): string {
  if (status === "failed" || status === "cancelled") return "tag tag--danger";
  if (status === "running") return "tag tag--info";
  if (status === "pending" || status === "queued") return "tag tag--warning";
  if (status === "succeeded") return "tag tag--success";
  return "tag tag--neutral";
}

export function getReleaseGateTagClass(status?: string | null): string {
  if (status === "fail") return "tag tag--danger";
  if (status === "warn") return "tag tag--warning";
  if (status === "pass") return "tag tag--success";
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
      title: "Sections are not ready for this report yet.",
      detail: "Check the findings below, or open the run and artifacts if you need the raw evidence before the section summary is available.",
    };
  }
  return {
    title: "This report has no section summary yet.",
    detail: "Open the run and artifacts to confirm whether the analysis finished with an intentionally empty report or stopped before section output was written.",
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
      title: "No findings were recorded for this report.",
      detail: "The release gate is passing. Review the sections or artifacts if you want the supporting evidence for this clean result.",
    };
  }
  if ((input.releaseGateStatus === "warn" || input.releaseGateStatus === "fail") && input.sectionsCount > 0) {
    return {
      title: "No findings were listed, but this report still needs review.",
      detail: `The release gate is currently ${input.releaseGateStatus === "warn" ? "warning" : "failing"}. Review the sections, run logs, and artifacts before treating this run as clean.`,
    };
  }
  if (input.sectionsCount > 0) {
    return {
      title: "No findings were pulled out of the available sections.",
      detail: "Review the sections above and the artifacts below if you need to see what the analysis covered.",
    };
  }
  return {
    title: "This report does not list any findings yet.",
    detail: "Open the run and artifacts to confirm whether the analysis finished cleanly or stopped before findings were written.",
  };
}

function buildWorkspaceReportCodeHref(input: {
  workspaceId: string;
  sourceId: string;
  reportId: string;
  filePath?: string | null;
  findingId?: string | null;
  branchName?: string | null;
  baseRef?: string | null;
}): Route {
  const params = new URLSearchParams();
  params.set("sourceId", input.sourceId);
  if (input.filePath) {
    params.set("path", input.filePath);
  }
  params.set("reportId", input.reportId);
  if (input.findingId) {
    params.set("findingId", input.findingId);
  }
  const branchName = normalizeNonEmptyString(input.branchName);
  if (branchName) {
    params.set("ref", branchName);
    params.set("compare", input.baseRef && input.baseRef.trim().length > 0 ? input.baseRef : "HEAD");
  }
  return `/portal/workspaces/${input.workspaceId}/code?${params.toString()}` as Route;
}

export function getChangesetBranchName(input: {
  branchName?: string | null;
  pullInstructions?: string[] | null;
}): string | null {
  const explicit = normalizeNonEmptyString(input.branchName);
  if (explicit) {
    return explicit;
  }
  for (const instruction of input.pullInstructions ?? []) {
    const parsed = extractBranchNameFromPullInstruction(instruction);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

export function getWorkspaceReportRemediationCodeHref(input: {
  workspaceId: string;
  sourceId: string;
  reportId: string;
  filePath: string;
  branchName?: string | null;
  baseRef?: string | null;
}): Route {
  return buildWorkspaceReportCodeHref(input);
}

export function getWorkspaceReportFindingCodeHref(input: {
  workspaceId: string;
  sourceId: string;
  reportId: string;
  findingId: string;
  filePath?: string | null;
  branchName?: string | null;
  baseRef?: string | null;
}): Route {
  return buildWorkspaceReportCodeHref(input);
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
      title: "Remediation changes are ready",
      detail: "SpecLens already prepared a reviewable fix for this report. Open the remediation run if you need the logs or artifacts behind it.",
      canOpenRun: Boolean(input.latestRemediationJobId),
    };
  }

  if (!input.latestRemediationJobId) {
    return {
      tagClass: "tag tag--neutral",
      title: "No remediation run has been started for this report yet.",
      detail: "Start remediation from this report when you want SpecLens to queue a fix run and prepare reviewable changes.",
      canOpenRun: false,
    };
  }

  if (input.latestRemediationJobStatus === "pending" || input.latestRemediationJobStatus === "queued") {
    return {
      tagClass: "tag tag--warning",
      title: "Remediation run queued",
      detail: "A remediation run is already queued for this report. Open the run to follow progress, logs, and artifacts while SpecLens prepares the fix.",
      canOpenRun: true,
    };
  }

  if (input.latestRemediationJobStatus === "running") {
    return {
      tagClass: "tag tag--warning",
      title: "Remediation run in progress",
      detail: "SpecLens is still working on the fix for this report. Open the run to follow progress, logs, and artifacts.",
      canOpenRun: true,
    };
  }

  if (input.latestRemediationJobStatus === "failed" || input.latestRemediationJobStatus === "cancelled") {
    return {
      tagClass: input.latestRemediationJobStatus === "failed" ? "tag tag--danger" : "tag tag--neutral",
      title: "Latest remediation run needs review",
      detail: "The latest remediation run did not finish cleanly, so there is no reviewable fix yet. Open the run to inspect logs and artifacts before retrying.",
      canOpenRun: true,
    };
  }

  return {
    tagClass: "tag tag--neutral",
    title: "Latest remediation run finished without reviewable changes",
    detail: "The remediation run finished, but there is no fix output yet. Open the run to inspect logs and artifacts before deciding whether to retry.",
    canOpenRun: true,
  };
}

export function isWorkspaceScopedReportContext(
  workspaceId: string,
  ...scopedEntities: WorkspaceScopedEntityLike[]
): boolean {
  return scopedEntities.every(entity => isWorkspaceScopedEntityLike(workspaceId, entity));
}

export function isWorkspaceScopedJobContext(
  workspaceId: string,
  ...scopedEntities: WorkspaceScopedEntityLike[]
): boolean {
  return scopedEntities.every(entity => isWorkspaceScopedEntityLike(workspaceId, entity));
}

export function isWorkspaceScopedCodeReviewContext(
  workspaceId: string,
  review: { workspaceId?: string | null; source?: { id?: string | null } | null } | null | undefined,
  workspaceSources: Array<{ id?: string | null } | null | undefined>,
): boolean {
  if (review?.workspaceId !== workspaceId || !review.source?.id) {
    return false;
  }
  return workspaceSources.some(source => source?.id === review.source?.id);
}

export function isWorkspaceScopedCodePageContext(
  workspaceId: string,
  review: { workspaceId?: string | null; source?: { id?: string | null } | null } | null | undefined,
  workspaceConsole: WorkspaceConsoleContextLike,
): boolean {
  return isWorkspaceScopedCodeReviewContext(workspaceId, review, workspaceConsole.sources ?? [])
    && isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole);
}

export function isWorkspaceScopedWorkspaceConsoleContext(
  workspaceId: string,
  workspaceConsole: WorkspaceConsoleContextLike,
): boolean {
  if (workspaceConsole.workspace?.id !== workspaceId) {
    return false;
  }
  return [
    ...(workspaceConsole.members ?? []),
    ...(workspaceConsole.sources ?? []),
    ...(workspaceConsole.installations ?? []),
    ...((workspaceConsole.jobs ?? []).flatMap(envelope => [envelope?.job, envelope?.report].filter(Boolean))),
  ].every(entity => entity?.workspaceId === workspaceId);
}

export function isWorkspaceScopedReportPageContext(
  workspaceId: string,
  scopedEntities: WorkspaceScopedEntityLike[],
  workspaceConsole: WorkspaceConsoleContextLike,
): boolean {
  return isWorkspaceScopedReportContext(workspaceId, ...scopedEntities)
    && isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole);
}

export function isWorkspaceScopedEntityPage(
  workspaceId: string,
  entities: WorkspaceScopedEntityLike[],
): boolean {
  return entities.every(entity => isWorkspaceScopedEntityLike(workspaceId, entity));
}

export function isWorkspaceScopedJobsPage(
  workspaceId: string,
  jobs: WorkspaceScopedJobEnvelopeLike[],
): boolean {
  return jobs.every(job => job?.job?.workspaceId === workspaceId && (!job.report || job.report.workspaceId === workspaceId));
}

export function isWorkspaceScopedGithubRepositoriesPage(
  workspaceInstallations: Array<{ githubInstallationId?: string | null } | null | undefined>,
  repositories: Array<{ githubInstallationId?: string | null } | null | undefined>,
): boolean {
  const installationIds = new Set(
    workspaceInstallations
      .map(installation => installation?.githubInstallationId)
      .filter((installationId): installationId is string => Boolean(installationId)),
  );
  return repositories.every(repository => {
    const installationId = repository?.githubInstallationId;
    return typeof installationId === "string" && installationIds.has(installationId);
  });
}

export function isWorkspaceScopedSourcesPageContext(
  workspaceId: string,
  workspaceConsole: WorkspaceConsoleContextLike,
  sources: WorkspaceScopedEntityLike[],
  githubRepositories: Array<{ githubInstallationId?: string | null } | null | undefined>,
): boolean {
  return isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)
    && isWorkspaceScopedEntityPage(workspaceId, sources)
    && isWorkspaceScopedGithubRepositoriesPage(workspaceConsole.installations ?? [], githubRepositories);
}

export function canManageWorkspaceJobLifecycle(
  jobKind: string,
  isWorkspaceOwner: boolean,
): boolean {
  return isWorkspaceOwner;
}

export function canManageWorkspaceRemediation(isWorkspaceOwner: boolean): boolean {
  return isWorkspaceOwner;
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
