# SpecLens

SpecLens is a hosted, spec-driven repository analysis SaaS with a dual-license codebase.

Iteration 5 builds on the hosted product foundation by restoring the analysis breadth of the archived system on the active TypeScript architecture.

The current product includes:

- a Next.js marketing site and portal at `speclens.tinamk.no`
- a Fastify API control plane
- isolated Docker runner workers on DigitalOcean droplets
- a dedicated AI worker plane for queued hosted analysis and remediation
- PostgreSQL for product state
- S3-compatible object storage for artifact storage, defaulting to local MinIO with optional external providers (Spaces/S3-compatible)
- Keycloak for identity
- Stripe for self-serve Pro billing
- GitHub App integration for private repositories
- ordered AI provider selection, including OpenAI and OpenAI Codex
- parity-oriented presets and capability packs for archived SpecLens analysis families
- queued hosted job execution with lifecycle status and log retrieval
- bounded remediation export from completed reports into reviewable changesets, patch bundles, and pull instructions

## Current focus

- Current iteration: `docs/iterations/ITERATION-005-behavioral-parity-migration.md`
- Living architecture docs: `docs/architecture/INDEX.md`
- Issue docs:
  - `docs/issues/behavioral-parity-migration.md`
  - `docs/issues/hosted-saas-platform.md`
  - `docs/issues/keycloak-provider-storage-dev-mode.md`
- Current architecture ADRs:
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`
  - `docs/adr/ADR-0004-hosted-saas-control-plane-runner-and-dual-license.md`
- Active apps:
  - `apps/web`
  - `apps/api`
  - `apps/runner`
  - `apps/ai-worker`

## Product model

### Hosted SaaS plans

- Free:
  - public GitHub repositories only
  - shared workspaces
  - hosted reports and live analysis logs
- Pro:
  - `$19.99 / month`
  - marketed as `~200 NOK`
  - private GitHub repositories via GitHub App
  - ZIP/TAR Git repository uploads
  - shared workspaces with owner/member roles

### Dual licensing

SpecLens is dual licensed:

- the repository code is source-available under a non-commercial license
- companies that need commercial rights or self-hosting rights must contact us for a separate commercial license

Important distinction:

- hosted Free and Pro plans govern usage of the managed SaaS
- the codebase itself is not offered under a permissive commercial open-source license

See:

- [LICENSE](/home/tina/SpecLens/LICENSE)
- [LICENSE-COMMERCIAL.md](/home/tina/SpecLens/LICENSE-COMMERCIAL.md)
- `apps/web/app/license/page.tsx`
- `apps/web/app/commercial/page.tsx`

## Monorepo layout

```text
apps/
  web/     -> Next.js landing page, pricing, portal, legal pages, report views
  api/     -> Fastify control plane and webhook/API surface
  runner/  -> runner process for queued Docker sandbox jobs

packages/
  core/      -> shared repository analysis engine
  contracts/ -> Zod schemas and domain DTOs
  db/        -> Prisma schema and database access
  ui/        -> shared React UI building blocks

deploy/
  digitalocean/ -> App Platform and runner deployment scaffolding
```

## Living Architecture Rule

Architecture diagrams are part of the product documentation, not optional extras.

When a change affects:

- service boundaries
- auth and callback flows
- job routing or queue ownership
- worker behavior
- report/data model shape
- local or hosted deployment topology

update the relevant files in `docs/architecture/` in the same change set.

## Dependencies

For a one-command machine bootstrap on Ubuntu or Arch, use:

```bash
./scripts/setup-e2e.sh
```

Add `--with-playwright` if you also want the local Playwright Chromium install.
For the hosted DigitalOcean path, make sure the `speclens.tinamk.no` `A` record points to the deployed droplet's public IPv4 before running the public HTTPS verification step.

### Required for local development

- `git`
- Node.js and npm
- Docker Engine with the Docker Compose plugin

### Required for the Ansible-first DigitalOcean deployment path

- Python 3
- `ansible-playbook` and `ansible-galaxy`
- `rsync`
- OpenSSH client
- a local SSH keypair

### Optional but recommended

- `doctl` for DigitalOcean auth checks, inspection, and cleanup assistance
- `act` for local GitHub Actions verification

### Ubuntu

The commands below assume a recent Ubuntu release.

Install the core local-dev dependencies:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates gnupg rsync openssh-client python3 python3-pip nodejs npm docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Install Ansible:

```bash
sudo apt install -y software-properties-common
sudo add-apt-repository --yes ppa:ansible/ansible
sudo apt update
sudo apt install -y ansible
```

Install `doctl` using DigitalOcean's documented Ubuntu path:

```bash
sudo snap install doctl
mkdir -p ~/.config
doctl auth init --context personal
```

Install `act` using the upstream Linux install script:

```bash
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
```

### Arch Linux

Install the core local-dev and deployment dependencies:

```bash
sudo pacman -Syu --needed git curl ca-certificates rsync openssh python python-pip nodejs npm docker docker-compose ansible
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Install `doctl` using the official Linux binary install path:

```bash
cd "$(mktemp -d)"
arch="$(uname -m)"
case "$arch" in
  x86_64) doctl_arch="amd64" ;;
  aarch64) doctl_arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac
doctl_version="$(curl -fsSL https://api.github.com/repos/digitalocean/doctl/releases/latest | sed -n 's/.*\"tag_name\": \"v\\([^\"]*\\)\".*/\\1/p' | head -n 1)"
curl -fsSLO "https://github.com/digitalocean/doctl/releases/download/v${doctl_version}/doctl-${doctl_version}-linux-${doctl_arch}.tar.gz"
tar xf "doctl-${doctl_version}-linux-${doctl_arch}.tar.gz"
sudo install doctl /usr/local/bin/doctl
doctl auth init --context personal
```

Install `act` using the upstream Linux install script:

```bash
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
```

### After installing system dependencies

Open a new shell so the Docker group change takes effect, then install repo-specific dependencies:

```bash
npm install
ansible-galaxy collection install -r deploy/digitalocean/ansible/requirements.yml
```

If browser-oriented tests need a local Playwright browser install, run:

```bash
npx playwright install chromium
```

## Local development

```bash
npm install
npm run validate:local
npm run dev:web
npm run dev:api
npm run dev:runner
npm run dev:ai-worker
```

For the full hosted dev stack with local infrastructure:

```bash
cp .env.example .env
npm run dev:compose
```

That Compose stack starts:

- `web` on `http://localhost:3000`
- `api` on `http://localhost:4000`
- `runner` health on `http://localhost:4510`
- `ai-worker` health on `http://localhost:4520`
- `keycloak` on `http://localhost:8081`
- `postgres` on `localhost:5432`
- `minio` S3 API on `http://localhost:9000`
- `minio` console on `http://localhost:9001`

Local mutable state now defaults to home/XDG-scoped paths instead of `/tmp` or `/var/tmp`:

- state: `~/.local/state/speclens`
- cache/temp: `~/.cache/speclens`

When you use `docker-compose`, the runner and AI worker temp roots default to bind mounts under `.speclens-workspace/host-temp/` in the repo, so local container temp data also stays under your home directory by default.

Local Keycloak users are seeded for portal and E2E coverage:

- `owner@speclens.dev` / `owner-password`
- `member@speclens.dev` / `member-password`
- `outsider@speclens.dev` / `outsider-password`
- `admin@speclens.dev` / `admin-password`

The owner account is pre-seeded with `pro` entitlement so the local hosted flow can exercise Git repository archive uploads without depending on Stripe during the main deterministic suite.

### Hosted browser E2E

Run the deterministic hosted-product browser suite against the full local stack with:

```bash
npm run e2e:hosted
```

If the Compose stack is already running and you only want to rerun the browser suite:

```bash
npm run e2e:hosted:local
```

Run individual local suites with:

```bash
npm run e2e:public-site:local
npm run e2e:auth:local
npm run e2e:workspace-core:local
npm run e2e:workspace-settings:local
npm run e2e:remediation:local
npm run e2e:admin:local
npm run stack:validate
npm run e2e:workspace-settings:local
npm run e2e:admin:local
```

Run just the deterministic local GitHub App private-repo flow with:

```bash
npm run e2e:github:local
```

That local GitHub flow:

- creates an ephemeral timestamped workspace
- requests the real install URL from SpecLens
- asserts the GitHub App install URL and signed state shape
- simulates the callback back into SpecLens with `E2E_GITHUB_INSTALLATION_ID`
- never requires the browser to finish the GitHub UI flow

The local suite layout is now:

- `public-site.spec.ts`: public route rendering and CTA coverage
- `auth.spec.ts`: login, protected-route redirect, return-to, and logout
- `workspace-core.spec.ts`: workspace creation, source intake, run queueing, logs, reports, and member/outsider access
- `workspace-settings.spec.ts`: workspace-owned billing and GitHub settings
- `admin-local.spec.ts`: admin AI auth surface plus skill/role/agent CRUD and agent execution
- `github-local.spec.ts`: deterministic GitHub private-repo flow on the local stack

The run/report-bearing browser suites target the built-in `Smoke analysis agent` so queue, report, and GitHub coverage stay deterministic in both local and public-host environments while the heavier review agents remain available for manual or exploratory use.

### Webhook secrets

Configure both provider webhook secrets in `.env` for any environment that receives live callbacks:

- `STRIPE_WEBHOOK_SECRET`
- `GITHUB_APP_WEBHOOK_SECRET`

SpecLens verifies signed webhook payloads from the raw request body when those secrets are present. Rotate secrets by updating the provider dashboard and deployment env together, then replay a Stripe event and a GitHub installation event in staging before promoting the change.

### Stripe localhost webhooks

Stripe won’t accept `localhost` as a dashboard webhook URL. For local development, use the Stripe CLI to forward events into the local API:

```bash
stripe login
npm run dev:compose
npm run stripe:webhooks:listen
```

That forwards Stripe events to `http://localhost:4000/api/webhooks/stripe`.
The CLI prints a `whsec_...` signing secret on startup. Save it into `.env` with:

```bash
npm run stripe:webhooks:set-secret -- whsec_...
```

Then restart the API so the new secret is loaded.

To create a real local Checkout session for webhook verification:

```bash
npm run stripe:webhooks:create-checkout
```

That helper is meant for `API_AUTH_MODE=local-dev`. It prints a hosted Stripe Checkout URL from the local API. Open it in a browser, complete the test checkout, and the forwarded `checkout.session.completed` event should upgrade the local user/workspace entitlement to `pro`.

If you keep the default local Keycloak flow enabled, log into `http://localhost:3000`, create the checkout from the portal, and let the Stripe CLI handle only the webhook forwarding.

### GitHub localhost webhooks

SpecLens now assumes a single stable GitHub App gateway in hosted DigitalOcean, while local development registers its current listener through that gateway. GitHub itself should point only at the hosted gateway:

- `Setup URL`: `https://github.speclens.tinamk.no/auth/github/callback`
- `Webhook URL`: `https://github.speclens.tinamk.no/api/webhooks/github`

For local development, use `smee.io` as the transient public receiver that the hosted gateway forwards to.

1. Create a channel at `https://smee.io/new`
2. Save that URL into `.env`:

```bash
npm run github:webhooks:set-proxy -- https://smee.io/...
```

3. Start the local stack:

```bash
npm run dev:compose
```

4. Start the local GitHub webhook forwarder:

```bash
npm run github:webhooks:listen
```

That forwards webhook deliveries from the public `smee` URL into:

```text
http://127.0.0.1:4000/api/webhooks/github
```

On startup, the listener also registers the current local app URL plus `smee` URL with the hosted gateway. Then:

1. Click `Connect GitHub App` from whichever local host you are actually using (`localhost`, LAN IP, or Tailscale URL).
2. GitHub redirects to the hosted gateway.
3. The gateway redirects the browser back to the exact local host that initiated the install.
4. Installation webhooks continue to fan out through the hosted gateway into the currently registered local `smee` target.

Keep `GITHUB_APP_WEBHOOK_SECRET` identical in `.env` and in the GitHub App settings. The local proxy only forwards the request; signature verification still happens in the local API.

## Environment

Start from `.env.example` and configure:

- Keycloak / OIDC
- `ADMIN_EMAILS` for `/portal/admin/**` and `/api/admin/ai/**`
- Stripe
- GitHub App
- PostgreSQL
- S3-compatible object storage (MinIO by default; switch to external by changing `OBJECT_STORAGE_*`)
- Optional parallel object storage mirroring by setting `OBJECT_STORAGE_MIRROR_*` (writes to primary and mirror in parallel; downloads race both and take the first success; set `OBJECT_STORAGE_MIRROR_REQUIRED=true` to fail if the mirror upload fails)
- `APP_STATE_BACKEND=prisma|file`; the hosted path now defaults to Prisma, while `file` remains for migration/test compatibility
- runner image / sandbox settings
- ordered AI providers via `AI_PROVIDER_ORDER`
- the public DNS records; for the default hosted profile, `speclens.tinamk.no` must have an `A` record pointing at the deployed droplet

## Operations

- readiness: `GET /ready` (API) and `http://localhost:4510/ready` (runner)
- metrics: `GET /metrics` (API) and `http://localhost:4510/metrics` (runner)
- rate limiting: enable with `RATE_LIMIT_ENABLED=true`
- audit export: `npm run audit:export` (uses `AUDIT_EXPORT_*` env vars)
- backups: `npm run backup:postgres` and `npm run backup:object-storage`
- ops validation: `npm run ops:validate`
- production E2E: `npm run e2e:production` (requires `E2E_*` credentials plus `PLAYWRIGHT_BASE_URL` or `E2E_BASE_URL`; optionally set `E2E_API_READY_URL` if you want an explicit API readiness probe before Playwright starts)
- production public-site smoke: `npm run e2e:public-site:production`
- production auth smoke: `npm run e2e:auth:production`
- production workspace core: `npm run e2e:workspace-core:production`
- production workspace settings: `npm run e2e:workspace-settings:production`
- production admin E2E: `npm run e2e:admin:production` (requires dedicated `E2E_ADMIN_*` credentials)
- local GitHub E2E: `npm run e2e:github:local` (requires `E2E_GITHUB_INSTALLATION_ID`, `E2E_GITHUB_PRIVATE_REPO_URL`, and `E2E_GITHUB_PRIVATE_REPO_FULL_NAME`)
- public-host GitHub E2E: `npm run e2e:github:production` (requires dedicated `E2E_OWNER_*`, `PLAYWRIGHT_BASE_URL` or `E2E_BASE_URL`, plus the same `E2E_GITHUB_*` install/repo vars)

Production/public-host browser E2E now assumes dedicated `OWNER`, `MEMBER`, `OUTSIDER`, and optional `ADMIN` accounts. Workspace-mutating production tests always create timestamped workspaces. The public-host GitHub E2E uses the dedicated E2E owner account, creates an ephemeral timestamped workspace on every run, and simulates the callback instead of completing the GitHub browser install flow.
The production run/report specs use the same built-in `Smoke analysis agent` contract as local so task selection, queue timing, and report assertions remain aligned across environments.

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run validate:local`
- `act -l`
- `act push -W .github/workflows/speclens-e2e.yml -j validate`
- `act pull_request -W .github/workflows/speclens-e2e.yml -j validate -e .github/act/pull_request.json`

## Behavioral parity

The current hosted product now carries explicit parity concepts:

- presets: `generic`, `node-repo`, `python-service`, `go-service`, `svelte-web`, `tagtwo`, `client-legacy`
- capabilities such as repo inventory, spec checks/generation, component and UI inventories, consistency checks, license-policy analysis, browser self-check execution, visual inspection, interaction testing, chaos-advisor synthesis, and dashboard/report projection
- normalized report sections instead of the older per-tool report files

## Hosted service architecture

- App Platform hosts `apps/web` and `apps/api`
- runner droplets host the Docker sandbox runner plane
- PostgreSQL stores users, workspaces, jobs, reports, memberships, subscriptions, and GitHub installation links
- object storage stores uploads, source bundles, logs, reports, and rendered report assets

In local validation today, queueing, job persistence, Git repository archive uploads, runner execution, signed provider webhooks, live Stripe checkout sessions, and GitHub App authentication all use the durable hosted path. The remaining gaps are operational hardening items such as multi-process SSE fanout and deeper sandbox/resource governance.

## Legacy archive

The old local-first and demo-era materials now live under a single archive area:

- `archive/README.md`
- `archive/legacy-local-first/`
- `archive/legacy-vite-demo/`

The root repo is intentionally kept focused on the active hosted SaaS surface. The archive folders are still useful for historical evidence, migration reference, and older Design Science iterations, but they are no longer part of the live product path.
