import { PortalShell } from "@speclens/ui";
import { getHostedReport } from "../../../../lib/api";
import { requirePortalSession } from "../../../../lib/auth";

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  await requirePortalSession(`/portal/reports/${reportId}`);
  const report = await getHostedReport(reportId);

  return (
    <PortalShell eyebrow="Report" title={report.title}>
      <section className="report-hero">
        <p>This hosted report view renders normalized parity sections, findings, and export-ready run metadata.</p>
        <div className="report-grid">
          <div><strong>Total</strong><br />{report.summary.totalFindings}</div>
          <div><strong>High</strong><br />{report.summary.high}</div>
          <div><strong>Medium</strong><br />{report.summary.medium}</div>
          <div><strong>Low</strong><br />{report.summary.low}</div>
        </div>
      </section>
      <section className="portal-grid">
        {report.sections.map(section => (
          <article className="portal-panel" key={section.id}>
            <p className="tag">{section.status.toUpperCase()}</p>
            <h2>{section.title}</h2>
            <p><strong>Capability:</strong> {section.capability}</p>
            <p>{section.summary}</p>
            <pre className="data-preview">{JSON.stringify(section.data, null, 2)}</pre>
          </article>
        ))}
      </section>
      <section className="portal-grid">
        {report.findings.map(finding => (
          <article className="portal-panel" key={finding.id}>
            <p className="tag">{finding.severity.toUpperCase()}</p>
            <h2>{finding.title}</h2>
            <p><strong>Capability:</strong> {finding.capability}</p>
            <p>{finding.message}</p>
            <p><strong>Suggestion:</strong> {finding.suggestion}</p>
            {finding.evidence.length > 0 ? <p><strong>Evidence:</strong> {finding.evidence.join(", ")}</p> : null}
          </article>
        ))}
      </section>
      <section className="portal-grid">
        <article className="portal-panel">
          <h2>Artifacts</h2>
          {report.artifacts.length === 0 ? <p>No artifacts registered for this run.</p> : null}
          {report.artifacts.map((artifact, index) => (
            <div className="list-row" key={`${artifact.key}:${index}`}>
              <div>
                <strong>{artifact.key}</strong>
                <p>{artifact.mimeType} · {artifact.sizeBytes} bytes</p>
              </div>
              <a className="button-ghost" href={`${process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? "http://localhost:4000"}/api/jobs/${report.jobId}/artifacts/${index}`}>
                Download
              </a>
            </div>
          ))}
        </article>
      </section>
      <p><strong>Report:</strong> {reportId}</p>
    </PortalShell>
  );
}
