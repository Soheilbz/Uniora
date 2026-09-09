# Worksheet print contracts

These text fixtures are the canonical output contract for the Web application's fourteen research worksheets. `print.test.tsx` renders a fixed record and compares the printed blocks with these fixtures.

The fixtures are treated as controlled official-form assets. Change them only when the university approves a form change or when a verified rendering defect is corrected. A fixture must never be regenerated merely to silence a regression test.

Persian worksheets use localized digits according to the current form specification; scoring ceilings that are defined as ASCII remain ASCII.
