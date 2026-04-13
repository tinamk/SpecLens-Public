import { SiteHeader } from "../../components/site-header";

export default function LicensePage() {
  return (
    <div className="marketing-shell">
      <SiteHeader />
      <div className="legal-layout">
        <div className="legal-panel">
          <p className="eyebrow">Dual licensing</p>
          <h1>SpecLens license model</h1>
          <p>
            SpecLens is source-available under a non-commercial license by default. Companies that want commercial rights to
            use, adapt, redistribute, or self-host the codebase must obtain a separate commercial license.
          </p>
          <ul className="bullet-list">
            <li>Hosted Free and Pro plans govern usage of the managed SaaS.</li>
            <li>The repository code itself is not offered under a permissive open-source commercial license.</li>
            <li>Commercial self-hosted or company redistribution rights require a separate agreement.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
