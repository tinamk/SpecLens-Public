import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { JobLogConsole } from "../../../../components/portal-actions";
import { getHostedJob } from "../../../../lib/api";
import { requirePortalSession } from "../../../../lib/auth";

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  await requirePortalSession(`/portal/jobs/${jobId}`);
  const envelope = await getHostedJob(jobId);

  return (
    <PortalShell eyebrow="Analysis job" title="Live sandbox log">
      <JobLogConsole jobId={envelope.job.id} initialLogs={envelope.logs} initialStatus={envelope.job.status} />
      <section className="portal-grid">
        <article className="portal-panel">
          <h2>Job metadata</h2>
          <p><strong>Preset:</strong> {envelope.job.preset}</p>
          <p><strong>Runtime:</strong> {envelope.job.runtimeMode}</p>
          <p><strong>Source:</strong> {envelope.job.sourceLocation}</p>
          <p><strong>Created:</strong> {envelope.job.createdAt}</p>
        </article>
        <article className="portal-panel">
          <h2>Next step</h2>
          {envelope.report ? (
            <Link className="button" href={`/portal/reports/${envelope.report.id}`}>Open report</Link>
          ) : (
            <p>The report link will appear here once the queued job reaches a terminal state.</p>
          )}
        </article>
      </section>
      <p><strong>Job:</strong> {envelope.job.id}</p>
    </PortalShell>
  );
}
