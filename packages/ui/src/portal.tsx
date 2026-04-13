import type { ReactNode } from "react";

export function PortalShell({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <main className="portal-shell">
      <header className="portal-shell__header">
        <p className="portal-shell__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  );
}
