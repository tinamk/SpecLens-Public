import Link from "next/link";
import { PricingCard } from "@speclens/ui";
import { CheckoutButton } from "../../components/portal-actions";
import { SiteHeader } from "../../components/site-header";

export default function PricingPage() {
  return (
    <div className="marketing-shell">
      <SiteHeader />
      <section className="section">
        <h1>Pricing</h1>
        <p>Hosted SaaS plans govern use of the managed service. Commercial code licensing is a separate contact-led path.</p>
        <div className="pricing-grid">
          <PricingCard
            name="Free"
            price="$0"
            description="Hosted evaluation and public-repo analysis."
            bullets={[
              "Public GitHub repositories only",
              "Create shared workspaces",
              "Hosted report rendering",
              "Live job console",
            ]}
            cta={<Link className="button-ghost" href="/api/auth/login">Use Free</Link>}
          />
          <PricingCard
            name="Pro"
            price="$19.99 monthly / marketed as 200 NOK"
            description="Hosted access for private repos and archive uploads."
            bullets={[
              "Private GitHub repos",
              "ZIP/TAR uploads",
              "Keycloak sign-in and shared workspaces",
              "Stripe monthly billing in USD",
            ]}
            cta={<CheckoutButton label="Continue to checkout" />}
          />
          <PricingCard
            name="Commercial license"
            price="Contact us"
            description="Commercial usage of the codebase or self-hosted deployments."
            bullets={[
              "Commercial rights beyond the non-commercial source-available license",
              "Company procurement flow",
              "Self-hosted and internal deployment discussions",
              "Direct contact path for tailored terms",
            ]}
            cta={<Link className="button-secondary" href="/commercial">Contact us</Link>}
          />
        </div>
      </section>
    </div>
  );
}
