---
name: act-workflow-verify
description: Use this skill when working on SpecLens GitHub Actions, local CI verification, or act-based workflow debugging. It is for listing workflows, simulating push and pull_request runs, checking artifact behavior, and keeping the local act configuration aligned with .github/workflows/.
---

# Act Workflow Verify

## Overview

Use this skill whenever the task is about validating or debugging the repo’s GitHub Actions locally. The current primary workflow is `.github/workflows/speclens-e2e.yml`, and the standard local target is the `validate` job.

This skill is intentionally small: it relies on the committed `.actrc`, the event fixture in `.github/act/`, and the wrapper scripts in this skill.

## Workflow

1. Check prerequisites.
2. List workflows and jobs.
3. Run the `push` simulation.
4. Run the `pull_request` simulation.
5. Inspect generated artifacts under `.act/artifacts`.

## Commands

### Prerequisites

```bash
.codex/skills/act-workflow-verify/scripts/check-prereqs.sh
```

### List workflows

```bash
.codex/skills/act-workflow-verify/scripts/list-workflows.sh
```

### Simulate push

```bash
.codex/skills/act-workflow-verify/scripts/run-validate-push.sh
```

### Simulate pull request

```bash
.codex/skills/act-workflow-verify/scripts/run-validate-pr.sh
```

## Notes

- `act` depends on Docker Engine for the default Linux runner path used in this repo.
- The committed `.actrc` maps `ubuntu-latest` to `catthehacker/ubuntu:act-latest`.
- Artifact uploads are routed to `.act/artifacts` through `--artifact-server-path`.

## References

- Local workflow notes: `references/workflows.md`
