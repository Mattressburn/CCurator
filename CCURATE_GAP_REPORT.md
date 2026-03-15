# CCURATE Gap Report

## Scope
This report reflects the post-refactor state after rebranding to **CCurate**, removal of legacy preview/classification modules, and migration to a 1:1 technical scrape model.

## 1) Missing Field Extractions in `buildPayload`

### Addressed in this refactor
- `accountName`
- `contactName`
- `contactEmail`
- `customerName`

These fields are now derived from visible labeled text and included in the top-level payload.

### Still missing (present in Salesforce case UI in many orgs)
- `status`
- `priority`
- `severity`
- `owner`
- `entitlement`
- `origin`
- `environment` / `instance`
- `productVersion` / build identifiers when rendered in side panels only

### Why still missing
- Current extraction primarily uses broad visible text + label scanning and card parsing.
- Many org-specific fields live in compact-record-header regions or dynamic side panels with unstable selectors.
- Some values render only after lazy expansion and are not guaranteed present at scrape time.

## 2) Actor/Timestamp Reliability Gaps (Nested Shadow DOM)

### Observed weak points
- Event blocks parsed from concatenated text can lose structural boundaries when nested LWC Shadow DOM hosts flatten text unexpectedly.
- `inferActor` and `inferTimestamp` rely on prefix patterns (`From:`, `By:`, `Date:`, etc.); if label/value are split across shadow boundaries, regex extraction can miss them.
- Hidden/virtualized cards in background tabs can leak partial text when host visibility changes rapidly.
- Open email body extraction (`#contentpage_emailTemplateBodyContent`) is selector-stable, but actor/timestamp for that body may still be absent unless present in visible adjacent lines.

### Impact
- Some events have empty `actor` and/or `timestamp` despite complete UI data being visible to a user.
- Chronological ordering quality degrades when timestamps are missing for dense activity histories.

## 3) Redundant Utilities (`caseCleanerUtils.js` vs `normalize.js`)

The following functions are duplicated (same conceptual behavior in both modules):
- `textFromElement`
- `stripInvisible`
- `normalizeWhitespace`
- `normalizeText`
- `splitLines`
- `simpleHash` (near-equivalent implementation)

### Risk of duplication
- Divergent behavior over time (e.g., whitespace or unicode normalization updates applied in one module only).
- Harder debugging because callsites depend on subtly different utility objects.

### Recommendation
- Consolidate canonical text normalization into one module (`normalize.js`) and make utils consume it.
- Keep DOM-only helpers (`deepQueryAll`, `getSearchRoots`, visibility checks) in `caseCleanerUtils.js`.
- Add a small compatibility wrapper for legacy callers during migration.
