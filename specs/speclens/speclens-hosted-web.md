# SpecLens Hosted Web

## Goal

Define the hosted marketing, pricing, legal, portal, and report surface for Iteration 4.

## Scope (IN)

- landing page
- pricing page
- legal pages
- portal shell
- job log console
- report view

## Scope (OUT)

- legacy Vite demo UI

## Definitions (Source of truth)

- **Hosted web app**: `apps/web`

## Rules

### R1 - Marketing and pricing
1. The landing page must present Free, Pro, and Commercial options.
2. The page must explain the dual-license distinction between hosted SaaS and the codebase.

### R2 - Portal
1. The portal must expose workspace, job, and report surfaces.
2. The job page must present terminal/log styling.

## Acceptance checks
1. `/` renders a marketing landing page.
2. `/pricing`, `/license`, and `/commercial` exist.
3. `/portal`, `/portal/jobs/[id]`, and `/portal/reports/[id]` exist.
