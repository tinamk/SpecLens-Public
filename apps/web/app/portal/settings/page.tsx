import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { CodexAuthCard } from "../../../components/codex-auth-card";
import { getCurrentUser, getMyCodexAuthStatus } from "../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../lib/auth";
import { buildPortalPrimaryNav } from "../../../lib/portal";

export default async function PortalSettingsPage() {
  const session = await requirePortalSession("/portal/settings");
  const [user, userCodexAuth] = await Promise.all([
    getCurrentUser(),
    getMyCodexAuthStatus(),
  ]);
  const isAdmin = isPortalAdminSession(session);

  return (
    <PortalShell
      eyebrow="Settings"
      title="Account settings"
      pageTestId="portal-settings-page"
      primaryNav={buildPortalPrimaryNav(isAdmin)}
      activePrimaryNavKey="settings"
    >
      <section className="portal-stat-grid" aria-label="Account summary">
        <article className="portal-stat" data-testid="portal-settings-stat-entitlement">
          <span className="portal-stat__label">Entitlement</span>
          <span className="portal-stat__value">{user.entitlement}</span>
        </article>
        <article className="portal-stat" data-testid="portal-settings-stat-role">
          <span className="portal-stat__label">Role</span>
          <span className="portal-stat__value">{isAdmin ? "Admin" : "User"}</span>
        </article>
        <article className="portal-stat" data-testid="portal-settings-stat-provider">
          <span className="portal-stat__label">Identity</span>
          <span className="portal-stat__value">{user.identityProvider}</span>
        </article>
      </section>

      <section className="portal-grid">
        <article className="portal-panel xl:col-span-2" data-testid="portal-settings-account-panel">
          <PortalSectionHeader title="Session" />
          <PortalMetaList
            items={[
              { label: "Signed in as", value: user.displayName },
              { label: "Email", value: user.email },
              { label: "Entitlement", value: user.entitlement },
              { label: "Provider", value: user.identityProvider },
            ]}
          />
        </article>
        <article className="portal-panel portal-panel--accent" data-testid="portal-settings-environment-panel">
          <PortalSectionHeader title="Access" />
          <PortalMetaList
            items={[
              { label: "Portal role", value: isAdmin ? "Administrator" : "User" },
              { label: "Admin access", value: isAdmin ? "Enabled" : "Not granted" },
            ]}
          />
        </article>
      </section>

      <section className="portal-grid">
        <div className="xl:col-span-2">
          <CodexAuthCard
            title="My Codex auth"
            description="Register your own Codex session here. Jobs only use this account when you explicitly pick user auth or when auto-selection chooses it."
            initialAuth={userCodexAuth}
            devicePath="/api/me/ai/auth/device"
            verifyPath="/api/me/ai/auth/verify"
            logoutPath="/api/me/ai/auth/logout"
            importLocalPath="/api/me/ai/auth/import-local"
            testId="portal-settings-codex-auth"
          />
        </div>
      </section>

      <section className="portal-panel" data-testid="portal-settings-links-panel">
        <PortalSectionHeader title="Jump to" />
        <PortalLinkGrid testId="portal-settings-route-grid">
          <PortalLinkCard
            eyebrow="Operate"
            href="/portal/workspaces"
            testId="portal-settings-open-workspaces"
            title="Workspaces"
            tone="success"
          />
          <PortalLinkCard
            eyebrow="Plans"
            href="/pricing"
            testId="portal-settings-open-pricing"
            title="Pricing"
            tone="warning"
          />
          <PortalLinkCard
            eyebrow="Commercial"
            href="/commercial"
            testId="portal-settings-open-commercial"
            title="Commercial"
          />
          {isAdmin ? (
            <PortalLinkCard
              eyebrow="Admin"
              href="/portal/admin/ai/auth"
              testId="portal-settings-open-admin"
              title="Admin"
              tone="info"
            />
          ) : null}
        </PortalLinkGrid>
      </section>
    </PortalShell>
  );
}
