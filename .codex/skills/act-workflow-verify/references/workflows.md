# Current Workflow Surface

The repo currently has one committed workflow:

- `.github/workflows/speclens-e2e.yml`

It runs:

- checkout
- setup-node for Node 20
- `npm ci`
- `npm run validate:local`
- `actions/upload-artifact@v4` for `.speclens-workspace`

Local verification commands:

- `act -l`
- `act push -W .github/workflows/speclens-e2e.yml -j validate`
- `act pull_request -W .github/workflows/speclens-e2e.yml -j validate -e .github/act/pull_request.json`

Operational notes:

- Docker Engine is required for the default runner path.
- Artifacts are stored under `.act/artifacts` because of the committed `.actrc`.
- If `actions/upload-artifact@v4` behavior differs locally, inspect the artifact path first before assuming the workflow logic is wrong.
