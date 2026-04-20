import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { getCurrentUser } from "../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../lib/auth";
import { buildPortalPrimaryNav } from "../../../lib/portal";

export default async function PortalSettingsPage() {
  const session = await requirePortalSession("/portal/settings");
  const user = await getCurrentUser();
  const isAdmin = isPortalAdminSession(session);

  return (
    <PortalShell
      eyebrow="Settings"
      title="Portal settings"
      lede="Global settings stay separate from workspace-owned configuration. Use workspace settings for entitlement, billing, and GitHub installation state."
      pageTestId="portal-settings-page"
      primaryNav={buildPortalPrimaryNav(isAdmin)}
      activePrimaryNavKey="settings"
    >
      <section className="portal-grid">
        <article className="portal-panel" data-testid="portal-settings-account-panel">
          <span className="tag tag--success">Account</span>
          <h2>Current session</h2>
          <p><strong>User:</strong> {user.displayName}</p>
          <p><strong>Email:</strong> {user.email}</p>
          <p><strong>Entitlement:</strong> {user.entitlement}</p>
          <p><strong>Provider:</strong> {user.identityProvider}</p>
        </article>
        <article className="portal-panel" data-testid="portal-settings-environment-panel">
          <span className="tag tag--neutral">Environment</span>
          <h2>Access context</h2>
          <p><strong>Portal role:</strong> {isAdmin ? "administrator" : "workspace user"}</p>
          <p><strong>Admin access:</strong> {isAdmin ? "enabled for this user" : "not granted for this user"}</p>
        </article>
        <article className="portal-panel" data-testid="portal-settings-links-panel">
          <span className="tag tag--info">Links</span>
          <h2>Next steps</h2>
          <div className="stack-form">
            <Link className="button-secondary" data-testid="portal-settings-open-workspaces" href="/portal/workspaces">Open workspaces</Link>
            <Link className="button-ghost" data-testid="portal-settings-open-pricing" href="/pricing">Open pricing</Link>
            {isAdmin ? <Link className="button-ghost" data-testid="portal-settings-open-admin" href="/portal/admin/ai/auth">Open admin</Link> : null}
          </div>
        </article>
      </section>
    </PortalShell>
  );
}
