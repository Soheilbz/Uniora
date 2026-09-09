# Council print contracts

These text fixtures are the canonical output contract for the Web application's council minute and checklist. `print.test.tsx` renders a fixed record and compares every printed block with these fixtures.

The fixtures are reviewed as official-form assets: a change is intentional only when the university changes the form or when a verified defect in the Web renderer is corrected. Updating a fixture solely to make a failing test pass is not acceptable.

Identifiers and dates intentionally preserve the formatting specified by the current form contract.
