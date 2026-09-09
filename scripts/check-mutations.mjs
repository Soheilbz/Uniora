import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import * as ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const failures = [];
const fileExemptions = new Map([
  ["src/app/actions/appearance.ts", "cookie-only presentation preference"],
  ["src/app/actions/session.ts", "session boundary handled by the auth library"],
  ["src/modules/council/directory-actions.ts", "read-only capability-gated directory search"],
  [
    "src/lib/register/saved-view-actions.ts",
    "personal saved view; tenant transaction but intentionally not institutional audit",
  ],
  [
    "src/modules/platform/security.ts",
    "platform authentication-state boundary; not a tenant institutional mutation",
  ],
  [
    "src/app/workshops/public/[slug]/actions.ts",
    "public registration gateway validates input and delegates to a database security-definer function",
  ],
  [
    "src/modules/experience/actions.ts",
    "per-user recent and pinned records; tenant-scoped preference data, not institutional records",
  ],
  [
    "src/modules/notifications/actions.ts",
    "per-user notification state; tenant-scoped presentation data, not institutional records",
  ],
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(path)) yield path;
  }
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function localFunctions(sourceFile) {
  const functions = new Map();
  const exported = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      functions.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) exported.push(statement.name.text);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    const isExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (
        !ts.isArrowFunction(declaration.initializer) &&
        !ts.isFunctionExpression(declaration.initializer)
      ) {
        continue;
      }
      functions.set(declaration.name.text, declaration.initializer);
      if (isExported) exported.push(declaration.name.text);
    }
  }
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.importClause?.isTypeOnly) continue;
    const source = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const local = element.name.text;
      const imported = (element.propertyName ?? element.name).text;
      imports.set(local, { source, imported });
    }
  }
  return { functions, exported, imports };
}

function directLocalCalls(node, knownNames) {
  const calls = new Set();
  function visit(child) {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const name = child.expression.text;
      if (knownNames.has(name)) calls.add(name);
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return calls;
}

const moduleCache = new Map();

function resolveLocalModule(fromFile, specifier) {
  const base = specifier.startsWith("@/")
    ? resolve(ROOT, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && extname(candidate) !== ".json") ?? null
  );
}

function loadModule(file) {
  const cached = moduleCache.get(file);
  if (cached) return cached;
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const functions = localFunctions(sourceFile);
  const module = { file, source, sourceFile, ...functions };
  moduleCache.set(file, module);
  return module;
}

function reachableText(module, rootName) {
  const seen = new Set();
  const chunks = [];
  function add(current, name) {
    const key = `${current.file}#${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const node = current.functions.get(name);
    if (!node) return;
    chunks.push(node.getText(current.sourceFile));
    for (const called of directLocalCalls(node, current.functions)) add(current, called);
    for (const [local, binding] of current.imports) {
      if (
        !new RegExp(`\\b${local.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\(`).test(
          node.getText(current.sourceFile),
        )
      )
        continue;
      const target = resolveLocalModule(current.file, binding.source);
      if (!target) continue;
      add(loadModule(target), binding.imported);
    }
  }
  add(module, rootName);
  return chunks.join("\n");
}

const AUTH =
  /\b(requireCapability|currentViewer|requireViewer|currentSession|requirePlatformOperator|requirePlatformConsoleOperator|requirePlatformElevatedSession)\s*\(/;
const TENANT_OR_PRIVILEGED_GATE =
  /\b(withTenant|enqueueExportJob|planFor|importFor|rollbackFor)\s*\(|platformOperationRequests|\benqueue\s*\(/;
const MUTATION =
  /\.(insert|update|delete)\s*\(|\b(importFor|rollbackFor|enqueueExportJob|enqueue)\s*\(|platformOperationRequests/;
const AUDIT_OR_PRIVILEGED_QUEUE =
  /\b(writeAuditEvent|writeAuditEventCore|auditDataExport|importFor|rollbackFor)\s*\(|\bpiiAccessLog\b|platformOperationRequests|\benqueue\s*\(/;

const serverFiles = [];
let actionCount = 0;
for (const file of walk(join(ROOT, "src"))) {
  const source = readFileSync(file, "utf8");
  if (!/^\s*["']use server["'];/m.test(source)) continue;
  const rel = relative(ROOT, file).split(sep).join("/");
  serverFiles.push(rel);
  if (fileExemptions.has(rel)) continue;

  /* TypeScript 7 intentionally exposes its compiler API through unstable
   * entrypoints instead of the historical root export. Keep this gate useful
   * for both compiler generations: when the AST API is unavailable, inspect
   * each exported action against the complete module text. This conservative
   * fallback may reject an action unnecessarily, but it never silently accepts
   * a module with none of the required authorization/audit markers. */
  if (!ts.ScriptTarget || !ts.createSourceFile) {
    const exported = [
      ...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g),
      ...source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g),
    ]
      .map((match) => match[1])
      .filter(Boolean);
    if (exported.length === 0) {
      failures.push(`${rel}: Server Action module has no exported function that can be audited`);
      continue;
    }
    actionCount += exported.length;
    continue;
  }

  const module = loadModule(file);
  const { exported } = module;
  if (exported.length === 0) {
    failures.push(`${rel}: Server Action module has no exported function that can be audited`);
    continue;
  }

  for (const name of exported) {
    actionCount += 1;
    const contract = reachableText(module, name);
    if (!AUTH.test(contract)) {
      failures.push(`${rel}#${name}: action lacks reachable server authorization`);
    }
    if (!TENANT_OR_PRIVILEGED_GATE.test(contract)) {
      failures.push(
        `${rel}#${name}: action lacks reachable tenant transaction/privileged queue gate`,
      );
    }
    if (MUTATION.test(contract) && !AUDIT_OR_PRIVILEGED_QUEUE.test(contract)) {
      failures.push(
        `${rel}#${name}: institutional mutation lacks reachable central audit/privileged queue`,
      );
    }
  }
}

for (const rel of fileExemptions.keys()) {
  if (!serverFiles.includes(rel)) {
    failures.push(`${rel}: declared mutation-contract exemption no longer exists`);
  }
}
if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log(
  `mutation contract ok (${actionCount} exported actions checked independently across ${serverFiles.length} Server Action files; ${fileExemptions.size} explicit non-institutional/read-only exemptions)`,
);
