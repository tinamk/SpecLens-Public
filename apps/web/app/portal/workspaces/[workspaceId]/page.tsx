import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { CheckoutButton, CreateSourceForm, GithubInstallButton, QueueAnalysisForm } from "../../../../components/portal-actions";
import { getWorkspaceConsole } from "../../../../lib/api";
import { requirePortalSession } from "../../../../lib/auth";

export default async function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requirePortalSession(`/portal/workspaces/${workspaceId}`);
  const workspaceConsole = await getWorkspaceConsole(workspaceId);

  return (
    <PortalShell eyebrow="Workspace" title={workspaceConsole.workspace.name}>
      <section className="portal-grid">
        <article className="portal-panel">
          <h2>Add a source</h2>
          <p>Use a local path in development, a GitHub URL, or archive metadata for hosted-style flows.</p>
          <CreateSourceForm workspaceId={workspaceConsole.workspace.id} entitlement={workspaceConsole.workspace.entitlement} />
        </article>
        <article className="portal-panel">
          <h2>Queue analysis</h2>
          <p>Hosted jobs now enter a queue first, then run with lifecycle status and logs.</p>
          <QueueAnalysisForm
            workspaceId={workspaceConsole.workspace.id}
            sources={workspaceConsole.sources.map(source => ({
              id: source.id,
              displayName: source.displayName,
              visibility: source.visibility,
            }))}
          />
        </article>
        <article className="portal-panel">
          <h2>Billing and private repo access</h2>
          <p>
            Current entitlement: <strong>{workspaceConsole.workspace.entitlement}</strong>
          </p>
          <CheckoutButton workspaceId={workspaceConsole.workspace.id} label="Upgrade workspace owner to Pro" />
          <GithubInstallButton workspaceId={workspaceConsole.workspace.id} />
          <p className="subtle-note">
            GitHub App installs currently use a local integration state flow until provider wiring is complete.
          </p>
        </article>
      </section>

      <section className="portal-grid">
        <article className="portal-panel">
          <h2>Sources</h2>
          {workspaceConsole.sources.length === 0 ? <p>No sources yet.</p> : null}
          {workspaceConsole.sources.map(source => (
            <div className="list-row" key={source.id}>
              <div>
                <strong>{source.displayName}</strong>
                <p>{source.type} · {source.visibility}</p>
                <p>{source.location}</p>
              </div>
            </div>
          ))}
        </article>
        <article className="portal-panel">
          <h2>Jobs</h2>
          {workspaceConsole.jobs.length === 0 ? <p>No jobs queued yet.</p> : null}
          {workspaceConsole.jobs.map(job => (
            <div className="list-row" key={job.job.id}>
              <div>
                <strong>{job.job.id}</strong>
                <p>{job.job.status} · {job.job.preset} · {job.job.runtimeMode}</p>
              </div>
              <div className="nav-links">
                <Link className="button-ghost" href={`/portal/jobs/${job.job.id}`}>Logs</Link>
                {job.report ? <Link className="button-secondary" href={`/portal/reports/${job.report.id}`}>Report</Link> : null}
              </div>
            </div>
          ))}
        </article>
        <article className="portal-panel">
          <h2>GitHub installations</h2>
          {workspaceConsole.installations.length === 0 ? <p>No installations registered yet.</p> : null}
          {workspaceConsole.installations.map(installation => (
            <div className="list-row" key={installation.id}>
              <div>
                <strong>{installation.githubAccountLogin}</strong>
                <p>Installation {installation.githubInstallationId}</p>
              </div>
            </div>
          ))}
        </article>
      </section>
      <p><strong>Workspace ID:</strong> {workspaceConsole.workspace.id}</p>
    </PortalShell>
  );
}
