# SpecLens

SpecLens is a hosted, spec-driven repository analysis SaaS with a dual-license codebase.

Iteration 5 builds on the hosted product foundation by restoring the analysis breadth of the archived system on the active TypeScript architecture.

The current product includes:

- a Next.js marketing site and portal at `speclens.tinamk.no`
- a Fastify API control plane
- isolated Docker runner workers on DigitalOcean droplets
- PostgreSQL for product state
- S3-compatible object storage for artifact storage, including DigitalOcean Spaces or self-hosted MinIO
- Keycloak for identity
- Stripe for self-serve Pro billing
- GitHub App integration for private repositories
- ordered AI provider selection, including OpenAI and OpenAI Codex
- parity-oriented presets and capability packs for archived SpecLens analysis families
- queued hosted job execution with lifecycle status and log retrieval

## Current focus

- Current iteration: `docs/iterations/ITERATION-005-behavioral-parity-migration.md`
- Active issues:
  - `docs/issues/behavioral-parity-migration.md`
  - `docs/issues/hosted-saas-platform.md`
- Current architecture ADRs:
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`
  - `docs/adr/ADR-0004-hosted-saas-control-plane-runner-and-dual-license.md`
- Active apps:
  - `apps/web`
  - `apps/api`
  - `apps/runner`

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
  - ZIP/TAR archive uploads
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

## Local development

```bash
npm install
npm run validate:local
npm run dev:web
npm run dev:api
npm run dev:runner
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
- `keycloak` on `http://localhost:8081`
- `postgres` on `localhost:5432`
- `minio` S3 API on `http://localhost:9000`
- `minio` console on `http://localhost:9001`

## Environment

Start from `.env.example` and configure:

- Keycloak / OIDC
- Stripe
- GitHub App
- PostgreSQL
- S3-compatible object storage
- `APP_STATE_BACKEND=file|prisma` depending on whether you want local file snapshots or Prisma-backed app state
- runner image / sandbox settings
- ordered AI providers via `AI_PROVIDER_ORDER`

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run validate:local`

## Behavioral parity

The current hosted product now carries explicit parity concepts:

- presets: `generic`, `node-repo`, `svelte-web`, `tagtwo`, `client-legacy`
- capabilities such as repo inventory, spec checks/generation, component and UI inventories, consistency checks, license-policy analysis, browser self-check execution, visual inspection, interaction testing, chaos-advisor synthesis, and dashboard/report projection
- normalized report sections instead of the older per-tool report files

## Hosted service architecture

- App Platform hosts `apps/web` and `apps/api`
- runner droplets host the Docker sandbox runner plane
- PostgreSQL stores users, workspaces, jobs, reports, memberships, subscriptions, and GitHub installation links
- object storage stores uploads, source bundles, logs, reports, and rendered report assets

In local validation today, queueing, billing, and GitHub installation state are implemented in-process so the hosted flows can be exercised end to end before the production provider wiring is finished.

## Legacy archive

The old local-first and demo-era materials now live under a single archive area:

- `archive/README.md`
- `archive/legacy-local-first/`
- `archive/legacy-vite-demo/`

The root repo is intentionally kept focused on the active hosted SaaS surface. The archive folders are still useful for historical evidence, migration reference, and older Design Science iterations, but they are no longer part of the live product path.
