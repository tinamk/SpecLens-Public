import Link from "next/link";
import { SiteHeader } from "../../components/site-header";
import { SiteFooter } from "../../components/site-footer";

export default function LicensePage() {
  return (
    <div className="marketing-shell" data-testid="public-license-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-license-main">
        <section className="legal-hero" data-testid="public-license-hero">
          <p className="eyebrow">Dual licensing</p>
          <h1>SpecLens keeps managed SaaS access and codebase rights separate on purpose.</h1>
          <p className="hero-lede">
            SpecLens is source-available under a non-commercial license by default. Companies that want commercial rights to
            use, adapt, redistribute, or self-host the codebase need a separate commercial agreement.
          </p>
        </section>

        <section className="legal-grid">
          <article className="legal-panel">
            <span className="tag tag--warning">What the default license means</span>
            <h2>Code access is available, but not under a permissive commercial open-source model.</h2>
            <ul className="bullet-list">
              <li>Hosted Free and Pro plans govern usage of the managed SpecLens SaaS.</li>
              <li>The repository code itself is not offered under a permissive commercial open-source license.</li>
              <li>Commercial self-hosted or company redistribution rights require a separate agreement.</li>
            </ul>
          </article>
          <aside className="legal-panel">
            <span className="tag tag--success">Quick guide</span>
            <h3>Use this rule of thumb</h3>
            <p>If you are buying access to the hosted service, look at Pricing. If you need rights around the codebase, look at Commercial.</p>
            <div className="stack-form">
              <Link className="button-secondary" href="/pricing">View hosted plans</Link>
              <Link className="button-ghost" href="/commercial">Talk commercial licensing</Link>
            </div>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
