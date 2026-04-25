import { redirect } from "next/navigation";
import Link from "next/link";
import { PublicRouteState } from "../../components/public-route-state";
import { resolveSafeReturnTo } from "../../lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedReturnTo = typeof params.returnTo === "string" ? params.returnTo : "/portal/workspaces";
  const returnTo = resolveSafeReturnTo(requestedReturnTo, process.env.APP_URL ?? "http://localhost:13000");
  const authReason = typeof params.auth === "string" ? params.auth : null;

  if (authReason === "auth-config-required") {
    return (
      <PublicRouteState
        actions={(
          <>
            <Link className="button" data-testid="public-login-retry-auth" href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
              Retry after setup
            </Link>
            <Link className="button-secondary" data-testid="public-login-open-pricing" href="/pricing">See hosted plans</Link>
            <a className="button-ghost" data-testid="public-login-contact-support" href="mailto:hello@tinamk.no?subject=SpecLens%20portal%20access%20support">Contact support</a>
          </>
        )}
        description="SpecLens could not open a secure portal session in this environment. Retry after the identity provider is configured, or contact the team that manages this SpecLens workspace."
        eyebrow="Sign-in unavailable"
        heroTestId="public-login-auth-config-required-hero"
        mainTestId="public-login-auth-config-required-main"
        role="alert"
        testId="public-login-auth-config-required-page"
        title="The hosted portal cannot start sign-in right now."
      >
        <p className="subtle-note">
          Requested destination: <strong>{returnTo}</strong>
        </p>
      </PublicRouteState>
    );
  }

  if (authReason && authReason !== "callback-invalid") {
    redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return (
    <PublicRouteState
      actions={(
        <>
          <Link className="button" data-testid="public-login-continue" href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
            Continue to sign in
          </Link>
          <Link className="button-secondary" data-testid="public-login-view-pricing" href="/pricing">See hosted plans</Link>
          <Link className="button-ghost" data-testid="public-login-commercial" href="/commercial">Commercial licensing</Link>
        </>
      )}
      description="Continue through the configured identity provider to open workspaces, runs, reports, and Codex auth settings."
      eyebrow="Hosted portal"
      heroTestId="public-login-hero"
      mainTestId="public-login-main"
      testId="public-login-page"
      title="Sign in to SpecLens."
    >
      {authReason === "callback-invalid" ? (
        <p className="banner banner--warning" data-testid="public-login-callback-invalid" role="status">
          Your previous sign-in callback expired or could not be verified. Start a new sign-in session.
        </p>
      ) : null}
    </PublicRouteState>
  );
}
