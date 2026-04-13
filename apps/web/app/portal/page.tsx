import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { CreateWorkspaceForm } from "../../components/portal-actions";
import { getPortalWorkspaces } from "../../lib/api";
import { requirePortalSession } from "../../lib/auth";

export default async function PortalPage() {
  await requirePortalSession("/portal");
  const workspaces = await getPortalWorkspaces();

  return (
    <PortalShell eyebrow="Portal" title="Your workspaces">
      <section className="portal-grid">
        <article className="portal-panel">
          <h2>Create a new workspace</h2>
          <p>Each workspace can invite members, connect public or private GitHub sources, or upload archive bundles.</p>
          <CreateWorkspaceForm />
        </article>
        {workspaces.map(({ workspace, sources, members }) => (
          <article className="portal-panel" key={workspace.id}>
            <h2>{workspace.name}</h2>
            <p>{workspace.description ?? "No description yet."}</p>
            <p><strong>Entitlement:</strong> {workspace.entitlement}</p>
            <p><strong>Members:</strong> {members.length} | <strong>Sources:</strong> {sources.length}</p>
            <Link className="button-secondary" href={`/portal/workspaces/${workspace.id}`}>Go to workspace</Link>
          </article>
        ))}
      </section>
    </PortalShell>
  );
}
