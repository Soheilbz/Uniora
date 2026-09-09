#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
const fail = (message) => {
  console.error(`print contract: ${message}`);
  process.exitCode = 1;
};
const requireText = (source, needle, message) => {
  if (!source.includes(needle)) fail(message);
};

const pkg = JSON.parse(read("package.json"));
const layout = read("src/app/layout.tsx");
const cssFiles = [
  "src/app/globals.css",
  ...readdirSync("src/styles")
    .filter((name) => name.endsWith(".css"))
    .sort()
    .map((name) => `src/styles/${name}`),
];
const css = cssFiles.map(read).join("\n");
const minutes = read("src/components/council/minutes-document.tsx");
const printAnchor = read("src/components/engine/print-anchor.tsx");

if (pkg.dependencies?.["@fontsource/noto-nastaliq-urdu"] !== "^5.3.0") {
  fail("the self-hosted Nastaliq package must remain a production dependency");
}

for (const weight of ["400", "600", "700"]) {
  requireText(
    layout,
    `@fontsource/noto-nastaliq-urdu/${weight}.css`,
    `root layout no longer loads Nastaliq weight ${weight}`,
  );
}

requireText(css, "@page form-sheet", "worksheets lost their named A4 page");
requireText(css, "size: A4 portrait", "print CSS no longer declares A4 portrait");
requireText(css, "width: 210mm", "worksheet physical A4 width is missing");
requireText(css, "min-height: 297mm", "worksheet physical A4 height is missing");
requireText(css, "@page council-paper", "council papers lost their named A4 page");
requireText(css, ".council-minutes-sheet", "council minutes print class is missing");
requireText(css, ".worksheet-defense-minutes", "defence-minute print class is missing");
requireText(css, '"Noto Nastaliq Urdu"', "Nastaliq is no longer selected by the print stylesheet");
requireText(
  css,
  ".council-minutes-sheet {\n  font-family: var(--font-sans);",
  "research-council minutes must remain in the regular application font",
);
requireText(
  css,
  ".worksheet-defense-minutes {\n  font-family:",
  "final-defence minutes no longer opt into the Nastaliq print face",
);
if (/\.council-minutes-sheet\s*(?:,[^{]+)?\{[^}]*Noto Nastaliq Urdu/s.test(css)) {
  fail("research-council minutes must not use the Nastaliq print face");
}
requireText(
  minutes,
  '<Sheet className="council-minutes-sheet">',
  "council minutes no longer opt into the A4 print contract",
);
requireText(
  printAnchor,
  "document.fonts.ready",
  "printing can open before webfont shaping has settled",
);
requireText(
  printAnchor,
  "document.images",
  "printing can open before letterhead images have settled",
);

if (/fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net/.test(css + layout)) {
  fail("print fonts must remain self-hosted; an external font CDN was introduced");
}

if (!process.exitCode) console.log("print contract: ok");
