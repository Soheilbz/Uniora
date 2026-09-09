import { readFileSync } from "node:fs";

const failures = [];
const a11y = readFileSync("e2e/accessibility.spec.ts", "utf8");
const manual = readFileSync("docs/accessibility-checklist.md", "utf8");
for (const needle of [
  "AxeBuilder",
  'auth("platform.json")',
  "/platform/sign-in",
  "/platform",
  "/council-meetings/new",
  "/workshops/new",
  "/settings/users",
  "/settings/roles",
  "/settings/import",
  "/settings/data",
  "/settings/audit",
  "/print/users",
  "320",
  "640",
  "scrollWidth",
])
  if (!a11y.includes(needle)) failures.push(`e2e/accessibility.spec.ts missing ${needle}`);
for (const needle of ["NVDA", "VoiceOver", "200%", "400%", "keyboard"])
  if (!manual.includes(needle)) failures.push(`docs/accessibility-checklist.md missing ${needle}`);

const biome = readFileSync("biome.jsonc", "utf8");
for (const forbidden of [
  '"includes": ["src/components/ui/**", "src/hooks/**", "src/lib/utils.ts"]',
  '"noDoubleEquals": "off"',
  '"noArrayIndexKey": "off"',
]) {
  if (biome.includes(forbidden))
    failures.push(`biome.jsonc reintroduced broad UI lint suppression: ${forbidden}`);
}

if (failures.length) {
  for (const x of failures) console.error(`error: ${x}`);
  process.exit(1);
}
console.log("accessibility contract ok");
