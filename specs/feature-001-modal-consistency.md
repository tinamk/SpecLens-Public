# Feature 001 — Modal consistency (MVP)

## Goal
Ensure every modal in the app behaves consistently and is easy to close.

## Scope (IN)
- Implement ONE reusable Modal component.
- Provide ONE example page that opens the modal.
- Add E2E tests verifying close behavior.

## Scope (OUT)
- No design system overhaul.
- No advanced animations.
- No backend integration.

## Constraints
- Must support keyboard users:
  - ESC closes the modal
  - Focus is trapped inside the modal
  - Focus returns to the opener button on close
- Must support mouse users:
  - Clicking overlay closes the modal
  - Clicking the close button (X) closes the modal
- Must be accessible:
  - role="dialog", aria-modal="true"
  - Title is connected via aria-labelledby

## Acceptance checks
1. Modal can be opened by clicking a button labeled "Open modal".
2. Modal closes via:
   - close button (X)
   - overlay click
   - ESC key
3. While modal is open:
   - focus stays inside the modal when tabbing
4. When modal closes:
   - focus returns to "Open modal" button
5. E2E tests cover (2)-(4).

## Scenarios
### Scenario A: Close via ESC
Given the modal is open
When the user presses Escape
Then the modal is closed
And focus is on the opener button

### Scenario B: Close via overlay click
Given the modal is open
When the user clicks the overlay outside the dialog
Then the modal is closed
And focus is on the opener button

### Scenario C: Focus trap
Given the modal is open
When the user presses Tab repeatedly
Then focus never leaves the modal
