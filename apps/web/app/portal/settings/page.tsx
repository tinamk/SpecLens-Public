import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalSectionHeader, PortalShell } from "@speclens/ui";
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
      <section className="portal-stat-grid">
        <article className="portal-stat" data-testid="portal-settings-stat-entitlement">
          <span className="portal-stat__label">Entitlement</span>
          <span className="portal-stat__value">{user.entitlement}</span>
          <p>The current account-level service tier visible to this portal session.</p>
        </article>
        <article className="portal-stat" data-testid="portal-settings-stat-role">
          <span className="portal-stat__label">Portal role</span>
          <span className="portal-stat__value">{isAdmin ? "Admin" : "User"}</span>
          <p>Administrator access is kept separate from workspace ownership.</p>
        </article>
        <article className="portal-stat" data-testid="portal-settings-stat-provider">
          <span className="portal-stat__label">Identity</span>
          <span className="portal-stat__value">{user.identityProvider}</span>
          <p>This is the auth provider backing the current session.</p>
        </article>
        <article className="portal-stat" data-testid="portal-settings-stat-scope">
          <span className="portal-stat__label">Scope split</span>
          <span className="portal-stat__value">Scoped</span>
          <p>Global account context stays here while entitlement and GitHub state remain workspace-owned.</p>
        </article>
      </section>

      <section className="portal-grid">
        <article className="portal-panel portal-panel--accent xl:col-span-2" data-testid="portal-settings-account-panel">
          <PortalSectionHeader
            badgeLabel="Account"
            badgeClassName="tag tag--success"
            title="Current session"
            description="Use this view to confirm who is signed in before making workspace-scoped changes."
          />
          <PortalMetaList
            items={[
              { label: "Signed-in user", value: user.displayName },
              { label: "Email", value: user.email },
              { label: "Entitlement", value: user.entitlement },
              { label: "Identity provider", value: user.identityProvider },
              { label: "Workspace settings", value: "Billing, GitHub installs, and repository inventory stay on each workspace settings route" },
            ]}
          />
        </article>
        <article className="portal-panel" data-testid="portal-settings-environment-panel">
          <PortalSectionHeader
            badgeLabel="Environment"
            title="Access context"
            description="Portal-wide permissions and workspace-owned permissions are intentionally separated."
          />
          <PortalMetaList
            items={[
              { label: "Portal role", value: isAdmin ? "administrator" : "workspace user" },
              { label: "Admin access", value: isAdmin ? "enabled for this user" : "not granted for this user" },
              { label: "Primary area", value: "Start from workspaces when you need to operate sources, runs, code, reports, or access" },
            ]}
          />
        </article>
      </section>

      <section className="portal-panel" data-testid="portal-settings-links-panel">
        <PortalSectionHeader
          badgeLabel="Next steps"
          badgeClassName="tag tag--info"
          title="Move back into the product"
          description="Open the exact surface you need instead of treating settings like a mixed dashboard."
        />
        <PortalLinkGrid testId="portal-settings-route-grid">
          <PortalLinkCard
            description="Go back to the workspace directory to open the right workspace-owned operating surface."
            eyebrow="Operate"
            href="/portal/workspaces"
            testId="portal-settings-open-workspaces"
            title="Open workspaces"
            tone="success"
          />
          <PortalLinkCard
            description="Review hosted plan boundaries before deciding whether this account or a workspace needs an entitlement change."
            eyebrow="Commercial"
            href="/pricing"
            testId="portal-settings-open-pricing"
            title="Open pricing"
            tone="warning"
          />
          <PortalLinkCard
            description="Keep the hosted SaaS path and the commercial rights path explicit when you need procurement or self-hosting."
            eyebrow="Procurement"
            href="/commercial"
            testId="portal-settings-open-commercial"
            title="Open commercial contact"
          />
          {isAdmin ? (
            <PortalLinkCard
              description="Open the admin AI surfaces when you need auth, skills, roles, or agent execution controls."
              eyebrow="Admin"
              href="/portal/admin/ai/auth"
              testId="portal-settings-open-admin"
              title="Open admin"
              tone="info"
            />
          ) : null}
        </PortalLinkGrid>
      </section>
    </PortalShell>
  );
}
