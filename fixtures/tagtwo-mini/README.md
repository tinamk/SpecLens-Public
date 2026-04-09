# tagtwo-mini

Sanitized multi-package fixture used to validate the TagTwo-first SpecLens iteration 2 workflow in CI and local development.

Included cases:

- allowed SPDX license
- review-needed license
- blocked license
- missing license metadata
- invalid SPDX expression
- valid `SEE LICENSE IN`
- broken `SEE LICENSE IN`
- valid multi-license `OR` expression
- valid `WITH` exception expression
- custom non-SPDX string that should remain review-needed
