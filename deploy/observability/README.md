# Observability Setup

SpecLens exposes Prometheus metrics from the API, runner, and AI worker processes:

- API metrics: `GET /metrics`
- Runner metrics: `http://localhost:4510/metrics`
- AI worker metrics: `http://localhost:4520/metrics`

## Prometheus scrape config (example)

```yaml
scrape_configs:
  - job_name: speclens-api
    metrics_path: /metrics
    static_configs:
      - targets: ["api.internal:4000"]
  - job_name: speclens-runner
    metrics_path: /metrics
    static_configs:
      - targets: ["runner.internal:4510"]
  - job_name: speclens-ai-worker
    metrics_path: /metrics
    static_configs:
      - targets: ["ai-worker.internal:4520"]
```

## Alert rules

See `deploy/observability/prometheus-alerts.yml` for the current baseline ruleset covering queue backlog, job failures, webhook failures, storage/readiness degradation, and AI worker outage/failure signals.

For live validation, use `npm run ops:validate`. The probe now checks:

- API, runner, and AI worker health/readiness endpoints
- metrics exposure for API, runner, and AI worker
- pg-boss queue publish/fetch/complete roundtrip
- object storage write/read/delete roundtrip
- portal root and auth route reachability
- auth callback invalid-state handling
- Keycloak issuer discovery when configured
- Stripe and GitHub webhook signature rejection, plus accepted signed webhook probes
- Stripe entitlement side effects and GitHub installation deletion side effects when the required validation env vars are provided
