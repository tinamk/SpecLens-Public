# Provider Secret Rotation

## Stripe

- Rotate `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the Stripe dashboard.
- Update secrets in your runtime environment and restart the API.
- Replay any failed webhooks if needed.

## GitHub App

- Rotate the GitHub App private key in the App settings.
- Update `GITHUB_APP_PRIVATE_KEY` (or file path) and restart the API.
- Rotate `GITHUB_APP_WEBHOOK_SECRET` and update the App webhook settings.

## Keycloak

- Rotate `KEYCLOAK_CLIENT_SECRET`.
- Update the API environment and restart.

## Object storage

- Rotate access keys (`OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`).
- If mirror is enabled, rotate mirror credentials as well.
