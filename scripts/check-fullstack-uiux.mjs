import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const failures = [];
const roots = ["src/app", "src/components", "src/modules", "src/lib"];

function walk(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(?:ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

const files = roots.flatMap(walk);
const production = files.filter((file) => !/\.(?:test|spec)\.tsx?$/.test(file));

function firstDirective(source) {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let inBlock = false;
  for (const raw of lines) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2).trim();
      inBlock = false;
    }
    if (line.startsWith("/*")) {
      const end = line.indexOf("*/", 2);
      if (end === -1) {
        inBlock = true;
        continue;
      }
      line = line.slice(end + 2).trim();
    }
    if (!line || line.startsWith("//")) continue;
    return line;
  }
  return "";
}

let serverActions = 0;
let clientModules = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const directives = [...source.matchAll(/^\s*["']use (server|client)["'];\s*$/gm)];
  for (const match of directives) {
    const kind = match[1];
    if (kind === "server") serverActions += 1;
    else clientModules += 1;
    const expected = `"use ${kind}";`;
    const first = firstDirective(source).replaceAll("'", '"');
    if (first !== expected) {
      failures.push(`${file}: ${expected} must be the first executable statement`);
    }
  }

  if (firstDirective(source).replaceAll("'", '"') === '"use server";') {
    for (const match of source.matchAll(/^export\s+async\s+function\s+(read[A-Za-z0-9_$]*)/gm)) {
      failures.push(`${file}: read query ${match[1]} must live outside the Server Action module`);
    }
  }

  if (firstDirective(source).replaceAll("'", '"') === '"use client";') {
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!match[1].startsWith("NEXT_PUBLIC_")) {
        failures.push(`${file}: client module reads non-public environment variable ${match[1]}`);
      }
    }
  }

  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (/dangerouslySetInnerHTML|\beval\s*\(|\bnew\s+Function\s*\(|\.innerHTML\s*=/.test(code)) {
    failures.push(
      `${file}: dangerous browser/code injection sink requires explicit security review`,
    );
  }

  for (const image of code.matchAll(/<img\b[^>]*>/gs)) {
    if (!/\balt\s*=/.test(image[0])) failures.push(`${file}: <img> is missing alt text`);
  }
}

if (serverActions < 10)
  failures.push(
    `directive scan found only ${serverActions} server modules; scan is probably broken`,
  );
if (clientModules < 20)
  failures.push(
    `directive scan found only ${clientModules} client modules; scan is probably broken`,
  );

function flatten(node, prefix = "", out = new Map()) {
  if (typeof node === "string") out.set(prefix, node);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node))
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

const catalogues = new Map(
  ["fa", "en"].map((locale) => [
    locale,
    flatten(JSON.parse(readFileSync(`src/messages/${locale}.json`, "utf8"))),
  ]),
);

for (const file of production) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(
    /(?:getTranslations|useTranslations)\(\s*["']([^"']+)["']\s*\)/g,
  )) {
    const namespace = match[1];
    for (const [locale, messages] of catalogues) {
      if (
        ![...messages.keys()].some((key) => key === namespace || key.startsWith(`${namespace}.`))
      ) {
        failures.push(`${file}: ${locale} catalogue has no namespace ${namespace}`);
      }
    }
  }
}

const modulesSource = readFileSync("src/lib/modules.ts", "utf8");
for (const match of modulesSource.matchAll(/labelKey:\s*["']([^"']+)["']/g)) {
  const path = match[1];
  for (const [locale, messages] of catalogues) {
    if (!messages.has(path))
      failures.push(`module registry: ${locale} catalogue is missing ${path}`);
  }
}

const attentionSource = readFileSync("src/modules/attention/rules.ts", "utf8");
for (const match of attentionSource.matchAll(/(?:labelKey|key):\s*["']([^"']+)["']/g)) {
  const path = `attention.${match[1]}`;
  for (const [locale, messages] of catalogues) {
    if (!messages.has(path))
      failures.push(`attention registry: ${locale} catalogue is missing ${path}`);
  }
}

const featureSource = readFileSync("src/app/sign-in/feature-panel.tsx", "utf8");
for (const match of featureSource.matchAll(/(?:title|body):\s*["']([^"']+)["']/g)) {
  const path = `auth.${match[1]}`;
  for (const [locale, messages] of catalogues) {
    if (!messages.has(path))
      failures.push(`sign-in feature registry: ${locale} catalogue is missing ${path}`);
  }
}

const sections = readFileSync("src/modules/settings/sections.ts", "utf8");
for (const match of sections.matchAll(/labelKey:\s*["']([^"']+)["']/g)) {
  const path = `settings.${match[1]}`;
  for (const [locale, messages] of catalogues) {
    if (!messages.has(path))
      failures.push(`settings registry: ${locale} catalogue is missing ${path}`);
  }
}

for (const file of production.filter((name) => /(?:queries\.ts|-queries\.ts)$/.test(name))) {
  const source = readFileSync(file, "utf8");
  if (/\bwithTenant\s*\(/.test(source)) {
    failures.push(
      `${file}: read/query module should use readOnly(), not a writable tenant transaction`,
    );
  }
}

const requiredUiContracts = [
  [
    "src/components/settings/institution-form.tsx",
    [
      "institution-timezone",
      "institution-locale",
      "institution-calendar-system",
      "aria-describedby",
    ],
  ],
  [
    "src/app/(app)/settings/ownership/ownership-form.tsx",
    [
      "ownership-user",
      'htmlFor="ownership-user"',
      "noCandidates",
      "confirmTitle",
      'variant="destructive"',
    ],
  ],
  ["src/app/security/setup/page.tsx", ["legacy route", 'redirect("/")']],
  ["src/app/security/challenge/page.tsx", ["legacy route", 'redirect("/")']],
  [
    "src/components/settings/participant-import.tsx",
    ["participant-import-file-label", "aria-labelledby"],
  ],
  [
    "src/components/council/council-attendance-editor.tsx",
    ["aria-pressed", "chooseSubstitute", "removeParticipant"],
  ],
  ["src/app/(app)/settings/data/page.tsx", ["PendingSubmitButton", "data.processing"]],
];
for (const [file, needles] of requiredUiContracts) {
  const source = readFileSync(file, "utf8");
  for (const needle of needles)
    if (!source.includes(needle)) failures.push(`${file}: missing UI/UX contract ${needle}`);
}

const institutionForm = readFileSync("src/components/settings/institution-form.tsx", "utf8");
if (/academicYearStartMonth|institution-academic-year-start-month/.test(institutionForm)) {
  failures.push(
    "reserved academicYearStartMonth must not be exposed before an academic-year feature consumes it",
  );
}

const i18nRequest = readFileSync("src/i18n/request.ts", "utf8");
if (!/institutions\.locale/.test(i18nRequest) || !/isLocale\(tenantLocale\)/.test(i18nRequest)) {
  failures.push(
    "institution default locale must be consumed by request i18n when no user cookie exists",
  );
}
const appShellCalendar = readFileSync("src/components/app-shell.tsx", "utf8");
if (!/CalendarSystemProvider[\s\S]*letterhead\.calendarSystem/.test(appShellCalendar)) {
  failures.push("institution calendarSystem must drive the authenticated date-picker context");
}

const settingRow = readFileSync("src/components/settings/setting-row.tsx", "utf8");
if (!settingRow.includes("flex flex-col sm:grid")) {
  failures.push(
    "SettingRow must stack label/control below the small breakpoint for zoom/mobile reflow",
  );
}

const datePicker = readFileSync("src/components/ui/date-picker.tsx", "utf8");
for (const needle of ["id={id}", "aria-label={ariaLabel}", "aria-describedby={ariaDescribedBy}"]) {
  if (!datePicker.includes(needle))
    failures.push(`DatePicker missing interactive-control contract ${needle}`);
}
if (/type="hidden"[^>]*id=\{id\}/s.test(datePicker)) {
  failures.push("DatePicker id must identify its visible trigger, not the hidden form value");
}

const globalSearch = readFileSync("src/components/global-search.tsx", "utf8");
for (const needle of ["CommandPrimitive.Input", "onValueChange={setQuery}", "exactDestination"]) {
  if (!globalSearch.includes(needle))
    failures.push(`global search missing keyboard-selection contract ${needle}`);
}
if (/onKeyDown=\{\(e\).*?e\.key\s*!==\s*["']Enter["']/s.test(globalSearch)) {
  failures.push(
    "global search must not override cmdk Enter selection with a manual first-result handler",
  );
}

const shell = readFileSync("src/components/app-shell.tsx", "utf8");
if (!/visibleSettingsSections\(viewer(?:,\s*enabledFeatures)?\)/.test(shell)) {
  failures.push(
    "AppShell settings breadcrumbs must use the shared capability-filtered settings registry",
  );
}

const settingsLayout = readFileSync("src/app/(app)/settings/layout.tsx", "utf8");
if (!/visibleSettingsSections\(viewer(?:,\s*enabledFeatures)?\)/.test(settingsLayout)) {
  failures.push("Settings layout must use the shared capability-filtered settings registry");
}

const dialog = readFileSync("src/components/ui/dialog.tsx", "utf8");
for (const needle of ["100dvh", "overflow-y-auto", "overscroll-contain"]) {
  if (!dialog.includes(needle))
    failures.push(`dialog primitive missing viewport-safety contract ${needle}`);
}

for (const locale of ["fa", "en"]) {
  const catalogue = JSON.parse(readFileSync(`src/messages/${locale}.json`, "utf8"));
  if (/Your data is safe|داده‌ها سالم‌اند/.test(catalogue?.boundary?.errorBody ?? "")) {
    failures.push(`${locale} boundary.errorBody makes an unprovable data-safety assurance`);
  }
}

const globalError = readFileSync("src/app/global-error.tsx", "utf8");
if (/Your data is safe|داده‌ها سالم‌اند/.test(globalError)) {
  failures.push("global-error.tsx makes an unprovable data-safety assurance");
}

const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
if (
  !/getTranslations\("settings"\)/.test(appShell) ||
  !/label:\s*settings\(section\.labelKey\)/.test(appShell)
) {
  failures.push("AppShell must resolve SETTINGS_SECTIONS labels through the settings namespace");
}

const e2eSettings = readFileSync("e2e/settings.spec.ts", "utf8");
for (const needle of [
  "/settings/ownership",
  "/settings/institution",
  "/security/challenge",
  "expectAccessible",
  "320",
]) {
  if (!e2eSettings.includes(needle)) failures.push(`e2e/settings.spec.ts missing ${needle}`);
}

const signInForm = readFileSync("src/app/sign-in/sign-in-form.tsx", "utf8");
for (const needle of [
  "autoFocus={!isValidTenantSlug(initialTenant.trim().toLowerCase())}",
  "autoFocus={platformMode || isValidTenantSlug(initialTenant.trim().toLowerCase())}",
]) {
  if (!signInForm.includes(needle)) failures.push(`sign-in focus contract missing ${needle}`);
}

const calendarDialog = readFileSync("src/components/calendar/entry-dialog.tsx", "utf8");
for (const needle of ["maxLength={2000}", 'error("notes")']) {
  if (!calendarDialog.includes(needle)) failures.push(`calendar notes contract missing ${needle}`);
}

const mfaSource = readFileSync("src/lib/mfa.ts", "utf8");
if (!/foldDigits\(candidate\.trim\(\)\)/.test(mfaSource)) {
  failures.push("MFA verification must fold Persian/Arabic-Indic digits before validating TOTP");
}
const tenantMfaPolicy = readFileSync("src/lib/viewer.ts", "utf8");
if (!/requireMfa:\s*false/.test(tenantMfaPolicy)) {
  failures.push("tenant viewer policy must keep MFA disabled for non-platform accounts");
}
const entityForm = readFileSync("src/components/engine/entity-form.tsx", "utf8");
if (!entityForm.includes("fieldError: (key: string) => string | undefined")) {
  failures.push("EntityForm custom slots must receive translated field-level server errors");
}
if (!entityForm.includes("aria-pressed={isActive}")) {
  failures.push("EntityForm section navigation must expose active state");
}

const decisionEditor = readFileSync("src/components/council/decision-template-editor.tsx", "utf8");
for (const needle of ["maxLength={4000}", "decision-text-error", "decision-description-error"]) {
  if (!decisionEditor.includes(needle)) failures.push(`decision editor contract missing ${needle}`);
}

const attendanceEditor = readFileSync(
  "src/components/council/council-attendance-editor.tsx",
  "utf8",
);
if (
  !attendanceEditor.includes('role="alert"') ||
  !attendanceEditor.includes("error?: string | undefined")
) {
  failures.push("council attendance custom slot must render its server validation error inline");
}

const institutionAction = readFileSync("src/modules/settings/institution.ts", "utf8");
for (const needle of ["values: submittedValues", "Object.entries(operational)"]) {
  if (!institutionAction.includes(needle))
    failures.push(`institution save-state/audit contract missing ${needle}`);
}

const i18nLifecycle = readFileSync("src/i18n/request.ts", "utf8");
if (!/cause instanceof TenantUnavailableError/.test(i18nLifecycle)) {
  failures.push(
    "request i18n must tolerate a tenant lifecycle transition after a session cookie is read",
  );
}

const lookupActions = readFileSync("src/modules/settings/lookups.ts", "utf8");
if (
  !/moveLookupEntry[\s\S]*writeAuditEvent\(tx,[\s\S]*position: \{ from: current\.position, to: nextPosition \}/.test(
    lookupActions,
  )
) {
  failures.push("lookup reordering must be audited in the same tenant transaction");
}
const neighbourAuditSnippet = ["entityId: `", "$", "{current.set}:$", "{neighbour.value}`"].join(
  "",
);
if (!lookupActions.includes(neighbourAuditSnippet)) {
  failures.push("lookup swaps must audit the neighbour row whose position also changes");
}

const profileActions = readFileSync("src/modules/settings/profile.ts", "utf8");
if (
  !/revokeDevice[\s\S]*delete\(session\)[\s\S]*action: "auth\.session\.revoked"/.test(
    profileActions,
  )
) {
  failures.push("self-service device revocation must delete and audit atomically");
}

const sidebarSource = readFileSync("src/components/ui/sidebar.tsx", "utf8");
if (/Math\.random\(/.test(sidebarSource)) {
  failures.push("sidebar skeleton must be deterministic across server render and hydration");
}

if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log(
  `full-stack/UI-UX contract ok (${serverActions} server modules, ${clientModules} client modules)`,
);
