# Production Readiness Checklist

This checklist captures the production-facing requirements for the hosted SpecLens SaaS. Local + Compose remains the validation target, but every item here has a production-facing control or documented operator step.

Operational notes:

- `npm run ops:validate` is the live-service probe. It assumes the API, runner, and AI worker are already running and reachable at `API_URL`, `RUNNER_URL`, and `AI_WORKER_URL`, and now validates health/readiness, metrics exposure, auth route reachability, queue roundtrip, object-storage roundtrip, and webhook signature handling.
- `npm run stack:validate` is the stack-level validation path. It boots the Compose stack, seeds Keycloak users, runs `ops:validate`, and then runs the broader hosted local E2E slice (`public-site`, `auth`, `workspace-core`, `workspace-settings`, `remediation-local`, `admin-local`, plus `github-local` when GitHub test env is configured).
- Live DigitalOcean verification is still a separate gate: repo-local validation does not replace a real deployed-environment run of `ops:validate`, `e2e:production`, and backup/restore drills.

## 1. Infrastructure & scaling

1. Scale API and runner horizontally with `pg-boss` and per-node concurrency limits (`API_MAX_CONCURRENT_ANALYSES`, `RUNNER_MAX_CONCURRENCY`).
2. Use readiness/liveness endpoints (`/ready`, `/health`) in the load balancer.
3. Define an autoscaling policy based on CPU and queue depth metrics (see `/metrics`).
4. Document runner pool sizing and queue backlog alarm thresholds.

## 2. Observability & operations

5. Centralized log aggregation for API + runner + AI worker structured logs (requestId + jobId + workspaceId).
6. Metrics exposure via `/metrics` for API + runner + AI worker (Prometheus scrape target).
7. Alerts for queue depth, job failures, webhook failures, storage errors, and AI worker outages/failures.
8. Incident runbook coverage for queue stalls, storage failures, and provider outages.

## 3. Data durability & recovery

9. Automated Postgres backups via `scripts/backup/postgres-backup.sh`.
10. Object storage backup via `scripts/backup/object-storage-backup.mjs`.
11. Restore procedure documented and verified (see `scripts/backup/postgres-restore.sh`).
12. Retention policy enforced with `WORKSPACE_RETENTION_DAYS`.

## 4. Security & compliance

13. Rate limiting enabled in production (`RATE_LIMIT_ENABLED=true`).
14. CSRF protections for session-cookie auth paths.
15. Audit logging enabled (`AUDIT_LOG_ENABLED=true`) + export path (`npm run audit:export`).
16. Secret rotation policy for Keycloak, Stripe, GitHub App, and storage credentials.

## 5. Provider live hardening

17. Stripe live webhooks (signed) configured and replay-safe (`StripeEvent` idempotency).
18. GitHub App live webhooks and install flow verified.
19. Keycloak realm configured for production session policies.
20. S3-compatible storage configured for primary + optional mirror replication.

## 6. Release gate

21. CI validates `npm run validate:local`.
22. Live-stack readiness probe passes (`npm run ops:validate`) against the target API + runner + AI worker deployment, including queue/storage roundtrips, webhook signature checks, and auth route probes.
23. Compose-stack validation passes (`npm run stack:validate`) on a clean local hosted stack.
24. Production E2E run (`npm run e2e:production` or `ansible-playbook deploy/digitalocean/ansible/playbooks/e2e.yml`).
25. Backup/restore drill after each major deployment.
