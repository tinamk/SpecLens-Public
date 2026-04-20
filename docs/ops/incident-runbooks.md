# Incident Runbooks

## Queue backlog / stalled jobs

1. Check `/metrics` for queue depth by status.
2. Verify `pg-boss` connectivity (`/ready`).
3. Restart runner pool if no workers are draining.
4. Inspect runner logs for sandbox failures or timeouts.

## Storage failures

1. Check `/ready` for object storage health.
2. If mirror is enabled, verify mirror status and run `npm run storage:verify-mirror`.
3. Fail open only if mirror is optional and primary is healthy.

## Provider outages (Stripe/GitHub/Keycloak)

1. Check webhook delivery status.
2. Pause dependent flows (billing or GitHub sources).
3. Verify signing secrets and rotation state.
4. Replay queued webhooks when provider is stable.
