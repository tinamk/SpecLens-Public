# Cost Posture

Default profile:

- one Droplet in `ams3`
- size `s-2vcpu-4gb`
- self-hosted Postgres, Keycloak, and MinIO on that node
- no App Platform
- no Managed Postgres
- no Spaces

Why this default:

- It is materially cheaper than combining App Platform, Managed Postgres, Spaces, and a runner Droplet.
- It keeps the current architecture deployable with one paid resource profile rather than several.
- `doctl` does not manage Spaces, so Spaces is not the most automation-friendly default for this skill.

Keep these tradeoffs visible:

- cheaper, but single point of failure
- operationally simpler, but less resilient
- good for prototype-hosted validation, not a final HA architecture

Operator references:

- Droplets pricing: https://www.digitalocean.com/pricing/droplets
- Managed databases pricing: https://www.digitalocean.com/pricing/managed-databases
- Spaces pricing: https://docs.digitalocean.com/products/spaces/details/pricing/
- App Platform pricing: https://docs.digitalocean.com/products/app-platform/details/pricing/
