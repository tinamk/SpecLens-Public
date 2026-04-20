import type { Route } from "next";
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
