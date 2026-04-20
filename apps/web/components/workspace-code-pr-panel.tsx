"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { GitPullRequestSummary } from "@speclens/contracts";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [loadRequested, props.prSupport, props.sourceId, props.workspaceId]);

  return (
    <article className="portal-panel" data-testid="workspace-code-pr-panel">
      <span className="tag tag--info">Pull requests</span>
      <h2>GitHub review</h2>
      {props.prSupport === "unavailable" ? <p className="subtle-note">PR metadata is only available for GitHub-backed sources.</p> : null}
      {props.prSupport === "available" && !loadRequested ? (
        <p>
          <button className="button-secondary" type="button" onClick={() => setLoadRequested(true)}>
            Load pull requests
          </button>
        </p>
      ) : null}
      {loading ? <p className="subtle-note">Loading pull requests…</p> : null}
      {error ? <p className="inline-error">{error}</p> : null}
      {!loading && !error && loadRequested && pullRequests.length === 0 && props.prSupport === "available" ? (
        <p className="subtle-note">No pull requests are available for this source.</p>
      ) : null}
      {pullRequests.map(prItem => (
        <div className="list-row" data-testid={`workspace-code-pr-${prItem.number}`} key={prItem.number}>
          <div>
            <strong>#{prItem.number} {prItem.title}</strong>
            <p>{prItem.state} · {prItem.headRef} {"->"} {prItem.baseRef}</p>
            {prItem.changedFiles !== null ? <p>{prItem.changedFiles} changed file(s)</p> : null}
            {String(prItem.number) === props.selectedPr ? <p className="subtle-note">Focused PR</p> : null}
          </div>
          <div className="list-row__actions">
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
        </div>
      ))}
    </article>
  );
}
