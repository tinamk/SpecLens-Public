# Iteration 1 vs Iteration 2

| Dimension | Iteration 1 | Iteration 2 |
|---|---|---|
| Primary case | client frontend | TagTwo repo profile |
| Default workflow | Browser-driven, Svelte/UI oriented | Repo-oriented, non-visual |
| External dependency risk | Requires live app access and sometimes credentials | Runs on local fixture without credentials |
| Core analyzers | Spec-check, visual, interaction, chaos | Repo inventory, local spec-check, license-policy checker |
| Reproducibility | Historical evidence in archived reports | Fixture-backed CI and fresh-clone validation |
| Generalization | Strong frontend case, limited repo breadth | Broader repo applicability across non-UI targets |

## Design Contribution
- Iteration 2 adds a generic license-policy compliance analyzer that works directly from npm-style JSON manifests and reports policy risk without making legal determinations.

## Honest Limitations
- License analysis remains npm-focused in iteration 2.
- The visual pipeline is preserved as legacy capability, not the primary TagTwo path.
- Automatic fixing is limited to human-approved patch drafts for simple metadata issues.
