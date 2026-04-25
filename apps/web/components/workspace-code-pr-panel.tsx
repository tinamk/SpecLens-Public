"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { PortalMetaList, PortalSectionHeader } from "@speclens/ui";
import type { GitPullRequestSummary } from "@speclens/contracts";
import { DataValue } from "./data-visuals";

function buildCodeHref(workspaceId: string, query: {
  sourceId: string;
  ref?: string | null;
  compare?: string | null;
  reportId?: string | null;
  pr?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("sourceId", query.sourceId);
  if (query.ref) params.set("ref", query.ref);
  if (query.compare) params.set("compare", query.compare);
  if (query.reportId) params.set("reportId", query.reportId);
  if (query.pr) params.set("pr", query.pr);
  return `/portal/workspaces/${workspaceId}/code?${params.toString()}`;
}

export function WorkspaceCodePrPanel(props: {
  workspaceId: string;
  sourceId: string;
  prSupport: "available" | "unavailable";
  activeReportId: string | null;
  selectedPr: string | null;
  initialPullRequest?: GitPullRequestSummary | null;
}) {
  const [pullRequests, setPullRequests] = useState<GitPullRequestSummary[]>(props.initialPullRequest ? [props.initialPullRequest] : []);
  const [loadRequested, setLoadRequested] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPullRequests = () => {
    setLoadRequested(true);
    setLoadAttempt(attempt => attempt + 1);
  };

  useEffect(() => {
    if (props.prSupport !== "available" || !loadRequested) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/proxy/api/workspaces/${encodeURIComponent(props.workspaceId)}/code/pulls?sourceId=${encodeURIComponent(props.sourceId)}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(await response.text() || `Failed to load pull requests (${response.status}).`);
        }
        return await response.json() as { pullRequests?: GitPullRequestSummary[] };
      })
      .then(payload => {
        if (cancelled) {
          return;
        }
        setPullRequests(payload.pullRequests ?? []);
      })
      .catch(fetchError => {
        if (cancelled) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load pull requests.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, loadRequested, props.prSupport, props.sourceId, props.workspaceId]);

  return (
    <article className="portal-panel" data-testid="workspace-code-pr-panel">
      <PortalSectionHeader
        badgeLabel="Pull requests"
        badgeClassName="tag tag--info"
        title="GitHub review"
        description="Load hosted PR metadata when the selected source is backed by a linked GitHub installation."
      />
      {props.prSupport === "unavailable" ? <p className="subtle-note">PR metadata is only available for GitHub-backed sources.</p> : null}
      {props.prSupport === "available" && !loadRequested ? (
        <p>
          <button className="button-secondary" type="button" onClick={requestPullRequests}>
            Load pull requests
          </button>
        </p>
      ) : null}
      {loading ? <p className="subtle-note">Loading pull requests…</p> : null}
      {error ? (
        <div className="stack-form">
          <p className="inline-error" role="alert">{error}</p>
          <button className="button-secondary" type="button" onClick={requestPullRequests}>
            Retry loading pull requests
          </button>
        </div>
      ) : null}
      {!loading && !error && loadRequested && pullRequests.length === 0 && props.prSupport === "available" ? (
        <p className="subtle-note">No pull requests are available for this source.</p>
      ) : null}
      {pullRequests.length > 0 ? (
        <div className="portal-record-grid">
          {pullRequests.map(prItem => (
            <article className="portal-record-card" data-testid={`workspace-code-pr-${prItem.number}`} key={prItem.number}>
                <div className="portal-record-card__header">
                  <div className="portal-record-card__title">
                    <h3>#{prItem.number} {prItem.title}</h3>
                    <p>Pull the review context directly into the code route without losing the active workspace source.</p>
                  </div>
                <div className="portal-record-card__meta">
                  <span className={prItem.state === "open" ? "tag tag--success" : "tag tag--neutral"}>{prItem.state}</span>
                  <span className="tag tag--info">{prItem.headRef} {"->"} {prItem.baseRef}</span>
                  {String(prItem.number) === props.selectedPr ? <span className="tag tag--warning">focused</span> : null}
                </div>
              </div>
              <PortalMetaList
                items={[
                  {
                    label: "Changed files",
                    value: prItem.changedFiles !== null ? `${prItem.changedFiles} file(s)` : "GitHub did not return a changed-file count",
                  },
                  { label: "Head ref", value: <DataValue value={prItem.headRef} /> },
                  { label: "Base ref", value: <DataValue value={prItem.baseRef} /> },
                ]}
              />
              <div className="portal-record-card__actions">
                <Link
                  className="button-secondary"
                  href={buildCodeHref(props.workspaceId, {
                    sourceId: props.sourceId,
                    ref: prItem.headRef,
                    compare: prItem.baseRef,
                    reportId: props.activeReportId,
                    pr: String(prItem.number),
                  }) as Route}
                >
                  Compare
                </Link>
                <a className="button-ghost" href={prItem.url} target="_blank" rel="noreferrer">Open PR</a>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </article>
  );
}
