# Auth And Access

SpecLens currently uses Keycloak for hosted authentication in local/dev and the active hosted stack.

## Auth Surfaces

- browser login for the portal
- API bearer-token validation
- admin AI device-flow management for Codex auth
- workspace and user-scoped authorization in the API

## Browser Auth Flow

```mermaid
sequenceDiagram
  participant U as Browser User
  participant C as Caddy
  participant W as apps/web
  participant K as Keycloak
  participant A as apps/api

  U->>C: GET /portal/workspaces
  C->>W: Forward request
  W->>W: Check session / token expiry
  W-->>U: Redirect to /api/auth/login if needed
  U->>C: GET /api/auth/login
  C->>W: Forward request
  W->>K: Redirect to OIDC authorization endpoint
  U->>K: Authenticate
  K-->>U: Redirect to /api/auth/callback
  U->>C: GET /api/auth/callback
  C->>W: Forward request
  W->>K: Exchange code for tokens
  W-->>U: Session cookie set
  U->>C: Retry portal request
  C->>W: Forward request
  W->>A: Call API with authenticated context
```

## API Auth Model

- `apps/web` handles browser-oriented login redirects and session cookies.
- `apps/api` validates the authenticated user on protected routes.
- `/portal/admin/**` and `/api/admin/ai/**` require an authenticated user whose email is allow-listed in `ADMIN_EMAILS`.
- Keycloak issuer validation uses:
  - a public issuer URL for browser-facing flows
  - an internal issuer URL for container-to-container verification

## Admin AI Device Flow

The admin AI panel manages Codex CLI-style OAuth device flow.

```mermaid
sequenceDiagram
  participant Admin as Admin User
  participant Web as apps/web admin page
  participant Api as apps/api
  participant OpenAI as OpenAI auth endpoints
  participant DB as AiAuth table
  participant Worker as apps/ai-worker

  Admin->>Web: Start device flow
  Web->>Api: POST /api/admin/ai/auth/device
  Api->>OpenAI: Request device code
  OpenAI-->>Api: device_code, user_code, verification_uri
  Api->>DB: Persist pending auth state
  Api-->>Web: Return code + verification URL
  Admin->>OpenAI: Complete verification
  Web->>Api: Poll verify/status endpoints
  Api->>OpenAI: Exchange / poll token state
  Api->>DB: Persist encrypted tokens
  Api->>Worker: Tokens become available via rendered auth.json staging
```

## GitHub App Gateway

SpecLens now treats GitHub App install callbacks and webhooks as a hosted gateway concern instead of binding them directly to the current local or production app URL.

```mermaid
sequenceDiagram
  participant Browser as Browser User
  participant Web as Local or Prod apps/web
  participant API as apps/api
  participant GH as GitHub App
  participant Gateway as Hosted GitHub Gateway
  participant Smee as smee.io

  Browser->>Web: Click Connect GitHub App
  Web->>API: GET /api/integrations/github/install
  API->>API: Persist install intent with targetAppUrl
  API-->>Browser: GitHub install URL with signed state
  Browser->>GH: Install or update app
  GH->>Gateway: Redirect to hosted Setup URL
  Gateway->>Gateway: Validate state + load install intent
  Gateway-->>Browser: Redirect to targetAppUrl/auth/github/callback
  Browser->>Web: Local callback
  Web->>API: POST /api/integrations/github/link
  API->>API: Consume install intent + link installation

  GH->>Gateway: POST installation webhook
  Gateway->>API: Apply canonical prod-side processing
  Gateway->>Smee: Forward event to active local dev listener when registered
```

Rules:

- GitHub should point only at the hosted gateway host for Setup URL and Webhook URL.
- The browser still returns to the exact host that initiated the install (`localhost`, LAN IP, Tailscale, or prod).
- Local webhook delivery is best-effort and uses the currently registered `smee.io` channel.

## Authorization Model

- all protected API actions resolve a current authenticated user
- workspace-scoped operations are checked against membership or ownership
- portal admin allow-list access is limited to `/portal/admin/**` and `/api/admin/ai/**`; it does not bypass workspace-owner checks for remediation or other workspace mutations
- admin AI flows require explicit admin allow-list membership through `ADMIN_EMAILS`
- job, report, source, and secret access are always user/workspace mediated through the API

## Sensitive Material

- browser sessions are cookie-based through `apps/web`
- Codex tokens are stored in `AiAuth` and staged into worker-local auth files for execution
- workspace secrets are encrypted at rest in `WorkspaceSecret`
- only workspace owners may attach stored workspace secrets to new hosted analysis jobs

## Practical Rule

When changing:

- login URLs
- callback URLs
- Keycloak hostname/base URL behavior
- token persistence
- admin AI auth routes

update this file and `docs/architecture/local-dev-stack.md`.
