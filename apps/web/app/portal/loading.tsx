import { PortalNoticePanel, PortalShell } from "@speclens/ui";

export default function PortalLoadingPage() {
  return (
    <PortalShell
      eyebrow="Portal"
      title="Loading workspace context..."
      lede="Fetching workspaces, runs, reports, and access checks. The page will settle into the portal shell when the server response is ready."
      pageTestId="portal-loading-page"
    >
      <PortalNoticePanel
        badgeLabel="Loading"
        badgeClassName="tag tag--info"
        title="Preparing the portal view"
        role="status"
        ariaLive="polite"
        description="Server data is still resolving. The skeleton below mirrors the final report and run layout so the page does not jump unexpectedly."
        actions={<a className="button-ghost" href="/portal/workspaces">Return to workspaces</a>}
      />
      <section className="portal-stat-grid" aria-hidden="true">
        <article className="portal-stat portal-skeleton" />
        <article className="portal-stat portal-skeleton" />
        <article className="portal-stat portal-skeleton" />
        <article className="portal-stat portal-skeleton" />
      </section>
      <section className="portal-panel portal-skeleton portal-skeleton--panel" aria-hidden="true" />
    </PortalShell>
  );
}
