#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = new Set(process.argv.slice(2));
const outputPath = 'docs/repo-surface-catalog.json';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel']);
}

function trackedFiles(root) {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return output.split('\n').filter(Boolean).sort();
}

function category(files, description, matcher) {
  const matched = files.filter(matcher).sort();
  return {
    count: matched.length,
    description,
    files: matched,
  };
}

function workflowFiles(files) {
  return files.filter(file => /^\.github\/workflows\/.+\.ya?ml$/.test(file)).sort();
}

function enforcedCheck(root, files, command) {
  const workflows = workflowFiles(files)
    .filter(file => readFileSync(join(root, file), 'utf8').includes(command))
    .sort();

  return {
    command,
    enforced: workflows.length > 0,
    workflows,
  };
}

function buildCatalog(root = repoRoot()) {
  const files = trackedFiles(root);

  return {
    schemaVersion: 1,
    categories: {
      rustPackages: category(
        files,
        'Tracked Rust package manifests across the runtime, CLI, crates, and protocol projects.',
        file => file.endsWith('Cargo.toml'),
      ),
      runtimeCrates: category(
        files,
        'First-party runtime crates under crates/.',
        file => /^crates\/[^/]+\/Cargo\.toml$/.test(file),
      ),
      toolPacks: category(
        files,
        'Optional integration tool packs under crates/aeqi-pack-*.',
        file => /^crates\/aeqi-pack-[^/]+\/Cargo\.toml$/.test(file),
      ),
      docs: category(
        files,
        'Markdown documentation under docs/.',
        file => /^docs\/.+\.md$/.test(file),
      ),
      designDocs: category(
        files,
        'Design notes and ADR-style documents under docs/design/.',
        file => /^docs\/design\/.+\.md$/.test(file),
      ),
      scripts: category(
        files,
        'Tracked operator, verification, install, and deploy scripts.',
        file => /^scripts\/.+/.test(file),
      ),
      workflows: category(
        files,
        'GitHub Actions workflow files.',
        file => /^\.github\/workflows\/.+\.ya?ml$/.test(file),
      ),
      apps: category(
        files,
        'Package manifests for frontend apps.',
        file => /^apps\/[^/]+\/package\.json$/.test(file),
      ),
      packages: category(
        files,
        'Package manifests for shared JavaScript packages.',
        file => /^packages\/[^/]+\/package\.json$/.test(file),
      ),
      agents: category(
        files,
        'Seeded local agent definitions.',
        file => /^agents\/[^/]+\.md$/.test(file),
      ),
    },
    enforcedChecks: {
      repoSurfaceCatalog: enforcedCheck(root, files, 'npm run surface:catalog:check'),
      publicSurfaceScan: enforcedCheck(root, files, 'scripts/public-surface-scan.sh'),
      goldenReadmeQuickstart: enforcedCheck(root, files, 'scripts/smoke-quickstart-readme.sh'),
      freshInstallSmoke: enforcedCheck(root, files, 'scripts/smoke-fresh-install.sh'),
      uiVerify: enforcedCheck(root, files, 'npm --prefix apps/ui run verify'),
      rustStrictLints: enforcedCheck(root, files, 'scripts/rust-strict-lints.sh'),
    },
  };
}

function formatCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function writeCatalog(root, catalog) {
  const absolutePath = join(root, outputPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, formatCatalog(catalog), 'utf8');
}

function checkCatalog(root, catalog) {
  const absolutePath = join(root, outputPath);
  const current = readFileSync(absolutePath, 'utf8');
  const expected = formatCatalog(catalog);

  if (current !== expected) {
    throw new Error(`${outputPath} is out of date; run npm run surface:catalog:write`);
  }
}

function printText(catalog) {
  console.log('AEQI repo surface catalog');
  console.log('');
  for (const [name, value] of Object.entries(catalog.categories)) {
    console.log(`${name}: ${value.count}`);
  }
  console.log('');
  for (const [name, value] of Object.entries(catalog.enforcedChecks)) {
    const marker = value.enforced ? 'enforced' : 'missing';
    console.log(`${name}: ${marker}`);
  }
}

const root = repoRoot();
const catalog = buildCatalog(root);

if (args.has('--write')) {
  writeCatalog(root, catalog);
} else if (args.has('--check')) {
  checkCatalog(root, catalog);
}

if (args.has('--json')) {
  process.stdout.write(formatCatalog(catalog));
} else {
  printText(catalog);
}
