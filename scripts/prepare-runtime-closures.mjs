import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const outputRoot = join(root, ".runtime-closures");
const targets = {
  tenant: ["scripts/job-worker.mjs"],
  platform: ["scripts/platform-worker.ts", "scripts/platform-backup.mjs"],
  operations: [
    "scripts/production-db-check.mjs",
    "scripts/platform-backup.mjs",
    "scripts/dr-readiness.mjs",
    "scripts/mfa-rotate.mjs",
    "scripts/audit-seal.mjs",
    "scripts/audit-partition.mjs",
    "scripts/platform.mjs",
    "scripts/db-observability.mjs",
    "scripts/db.mjs",
  ],
};
const importPattern = /(?:from\s*|import\s*\(|import\s*)(["'])(\.{1,2}\/[^"']+)\1/g;
const typedExtension = /\.(?:ts|tsx|mts)$/;

rmSync(outputRoot, { recursive: true, force: true });
for (const [target, entries] of Object.entries(targets)) {
  const targetRoot = join(outputRoot, target);
  const files = collect(entries);
  for (const file of files) emitRuntimeFile(targetRoot, file);
  cpSync(join(root, "package.json"), join(targetRoot, "package.json"));
  assertJavaScriptOnly(targetRoot, files);
  console.log(`${target}: ${files.size} runtime source files -> JavaScript closure`);
}

function emitRuntimeFile(targetRoot, file) {
  const rel = relative(root, file);
  const typed = typedExtension.test(rel);
  const outputRel = typed ? rel.replace(typedExtension, ".js") : rel;
  const destination = join(targetRoot, outputRel);
  mkdirSync(dirname(destination), { recursive: true });
  const source = readFileSync(file, "utf8");
  const rewritten = rewriteTypedSpecifiers(source);
  if (!typed) {
    writeFileSync(destination, rewritten);
    return;
  }
  const transpiled = ts.transpileModule(rewritten, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: true,
      sourceMap: false,
      inlineSourceMap: false,
      removeComments: false,
    },
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    const detail = errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("; ");
    throw new Error(`runtime TypeScript transpilation failed for ${rel}: ${detail}`);
  }
  writeFileSync(destination, transpiled.outputText);
}

function rewriteTypedSpecifiers(source) {
  return source.replace(importPattern, (full, _quote, specifier) => {
    if (!typedExtension.test(specifier)) return full;
    return full.replace(specifier, specifier.replace(typedExtension, ".js"));
  });
}

function assertJavaScriptOnly(targetRoot, sourceFiles) {
  for (const file of sourceFiles) {
    const rel = relative(root, file);
    const emitted = typedExtension.test(rel) ? rel.replace(typedExtension, ".js") : rel;
    if (!existsSync(join(targetRoot, emitted)))
      throw new Error(`runtime output missing: ${emitted}`);
    if (typedExtension.test(emitted))
      throw new Error(`runtime output retained TypeScript: ${emitted}`);
  }
}

function collect(entries) {
  const queue = entries.map((entry) => resolveInternal(join(root, entry), entry));
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const resolved = resolveSpecifier(file, match[2]);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

function resolveSpecifier(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(importer), specifier);
  return resolveInternal(candidate, `${relative(root, importer)} -> ${specifier}`);
}

function resolveInternal(candidate, label) {
  const normalized = resolve(candidate);
  if (!normalized.startsWith(`${root}/`))
    throw new Error(`runtime import escapes repository: ${label}`);
  const choices = extname(normalized)
    ? [normalized]
    : [
        normalized,
        `${normalized}.ts`,
        `${normalized}.tsx`,
        `${normalized}.mts`,
        `${normalized}.mjs`,
        `${normalized}.js`,
      ];
  for (const choice of choices) if (existsSync(choice) && statSync(choice).isFile()) return choice;
  throw new Error(`runtime dependency is missing: ${label}`);
}
