import CommercialContactForm from "../../components/commercial-contact-form";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function CommercialPage() {
  return (
    <div className="marketing-shell" data-testid="public-commercial-page">
      <SiteHeader />
      <main className="legal-layout" data-testid="public-commercial-main">
        <section className="legal-hero" data-testid="public-commercial-hero">
          <p className="eyebrow">Commercial licensing</p>
          <h1>Need commercial rights, procurement support, or a self-hosted deployment path?</h1>
          <p className="hero-lede">
            If your company wants to use SpecLens beyond the non-commercial source-available terms, deploy it internally, or
            negotiate broader usage rights, start the conversation here.
          </p>
        </section>

        <section className="legal-grid">
          <div className="legal-panel">
            <span className="tag tag--warning">Commercial scope</span>
            <h2>Common reasons teams reach out</h2>
            <ul className="bullet-list">
              <li>Commercial code licensing</li>
              <li>Self-hosted deployment discussions</li>
              <li>Procurement and contract review</li>
              <li>Company-specific usage terms</li>
            </ul>
            <p><strong>Contact:</strong> hello@tinamk.no</p>
          </div>
          <div className="legal-panel">
            <p className="eyebrow">Request access</p>
            <h2>Send a commercial licensing request</h2>
            <p>Share your licensing or self-hosting needs and we will follow up with the right contract path.</p>
            <CommercialContactForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
