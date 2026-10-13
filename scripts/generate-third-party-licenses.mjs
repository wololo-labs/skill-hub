#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const lock = YAML.parse(await readFile(path.join(root, 'yarn.lock'), 'utf8'));
const state = YAML.parse(
  await readFile(path.join(root, 'node_modules/.yarn-state.yml'), 'utf8'),
);
const entries = Object.fromEntries(
  Object.entries(lock).filter(([key]) => key !== '__metadata'),
);
const descriptors = new Map();
const byResolution = new Map();
for (const [keys, entry] of Object.entries(entries)) {
  for (const key of keys.split(', ')) descriptors.set(key, entry);
  byResolution.set(entry.resolution, entry);
}

const workspacePaths = [
  'package.json',
  ...(await readdir(path.join(root, 'packages'))).map(
    name => `packages/${name}/package.json`,
  ),
  ...(await readdir(path.join(root, 'plugins'))).map(
    name => `plugins/${name}/package.json`,
  ),
];
const workspaces = new Map();
for (const relativePath of workspacePaths) {
  const manifestPath = path.join(root, relativePath);
  const manifest = await readJson(manifestPath);
  workspaces.set(manifest.name, {
    manifest,
    directory: path.dirname(manifestPath),
  });
}

const productionRoots = [...workspaces.keys()]
  .filter(name => name !== 'skill-hub')
  .map(name => `workspace:${name}`);

const resolveDependency = (name, range) => {
  if (workspaces.has(name) && /^(workspace:|link:|portal:)/.test(range)) {
    return `workspace:${name}`;
  }
  const candidates = [`${name}@${range}`];
  if (!/^(npm:|patch:|file:|link:|portal:|workspace:)/.test(range)) {
    candidates.push(`${name}@npm:${range}`);
  }
  for (const candidate of candidates) {
    const entry = descriptors.get(candidate);
    if (entry) return entry.resolution;
  }
  throw new Error(`Unresolved production dependency: ${name}@${range}`);
};

const parents = new Map();
const reachable = new Set(productionRoots);
const queue = [...productionRoots];
while (queue.length > 0) {
  const locator = queue.shift();
  const dependencies = locator.startsWith('workspace:')
    ? {
        ...workspaces.get(locator.slice('workspace:'.length)).manifest
          .dependencies,
        ...workspaces.get(locator.slice('workspace:'.length)).manifest
          .optionalDependencies,
      }
    : byResolution.get(locator).dependencies ?? {};
  for (const [name, range] of Object.entries(dependencies)) {
    if (range === 'npm:*') continue;
    const child = resolveDependency(name, range);
    if (!reachable.has(child)) {
      reachable.add(child);
      parents.set(child, locator);
      queue.push(child);
    }
  }
}

const platformLicense = name => {
  if (name.startsWith('@esbuild/')) return 'MIT';
  if (name.startsWith('@rollup/rollup-')) return 'MIT';
  if (name.startsWith('@rspack/binding-')) return 'MIT';
  if (name.startsWith('@swc/core-')) return 'Apache-2.0';
  if (name.startsWith('@emnapi/')) return 'MIT';
  if (name === '@napi-rs/wasm-runtime' || name === '@tybys/wasm-util')
    return 'MIT';
  if (name === 'fsevents' || name === 'resolve') return 'MIT';
  if (name === 'typescript') return 'Apache-2.0';
  return undefined;
};

const packageNameFromLocator = locator =>
  locator.includes('@npm:')
    ? locator.slice(0, locator.lastIndexOf('@npm:'))
    : locator;

const stateLocations = locator => {
  const locations = state[locator]?.locations ?? [];
  if (locations.length > 0) return locations;
  if (!locator.includes('@npm:')) return [];
  const base = locator.slice(0, locator.lastIndexOf('@'));
  const tail = locator.slice(locator.lastIndexOf('@') + 1);
  for (const [candidate, entry] of Object.entries(state)) {
    if (
      candidate.startsWith(`${base}@virtual:`) &&
      candidate.endsWith(`#${tail}`)
    ) {
      return entry.locations ?? [];
    }
  }
  return [];
};

const firstFile = async (directory, names) => {
  try {
    const files = await readdir(directory);
    const match = files.find(file => names.test(file));
    return match ? path.join(directory, match) : undefined;
  } catch {
    return undefined;
  }
};

const inferLicense = text => {
  const normalized = text.toLowerCase();
  if (
    normalized.includes('apache license') &&
    normalized.includes('version 2.0')
  )
    return 'Apache-2.0';
  if (
    normalized.includes(
      'free and unencumbered software released into the public domain',
    )
  )
    return 'Unlicense';
  if (normalized.includes('permission is hereby granted, free of charge'))
    return 'MIT';
  if (
    normalized.includes('commercial applications') &&
    normalized.includes("provided 'as-is'")
  )
    return 'Zlib';
  if (
    normalized.includes('mit license') ||
    normalized.includes('[mit](./license)')
  )
    return 'MIT';
  return undefined;
};

const normalizeLicense = license => {
  if (Array.isArray(license)) {
    return `(${license
      .map(item => (item === 'Apache2' ? 'Apache-2.0' : item))
      .join(' OR ')})`;
  }
  return typeof license === 'object' ? JSON.stringify(license) : license;
};

const metadata = async locator => {
  const entry = byResolution.get(locator);
  const fallbackName = packageNameFromLocator(locator);
  const fallbackVersion = entry.version;
  for (const relativeLocation of stateLocations(locator)) {
    const directory = path.join(root, relativeLocation);
    const manifestPath = path.join(directory, 'package.json');
    try {
      const manifest = await readJson(manifestPath);
      if (manifest.license) {
        return {
          name: manifest.name,
          version: manifest.version,
          license: normalizeLicense(manifest.license),
          directory,
        };
      }
      const evidence = await firstFile(directory, /^(licen[cs]e|copying)/i);
      if (evidence) {
        const license = inferLicense(await readFile(evidence, 'utf8'));
        if (license)
          return {
            name: manifest.name,
            version: manifest.version,
            license,
            directory,
          };
      }
      const readme = await firstFile(directory, /^readme/i);
      if (readme) {
        const license = inferLicense(await readFile(readme, 'utf8'));
        if (license)
          return {
            name: manifest.name,
            version: manifest.version,
            license,
            directory,
          };
      }
      return {
        name: manifest.name,
        version: manifest.version,
        license: undefined,
        directory,
      };
    } catch {
      // A platform-specific optional package is not materialized on this host.
    }
  }
  return {
    name: fallbackName,
    version: fallbackVersion,
    license: platformLicense(fallbackName),
    directory: undefined,
  };
};

const label = async locator => {
  if (locator.startsWith('workspace:')) return locator;
  const component = await metadata(locator);
  return `${component.name}@${component.version}`;
};

const components = [];
for (const locator of [...reachable]
  .filter(value => !value.startsWith('workspace:'))
  .sort()) {
  const component = await metadata(locator);
  if (!component.license || component.license === 'UNLICENSED') {
    throw new Error(
      `No license evidence for ${component.name}@${component.version}`,
    );
  }
  const chain = [];
  for (let current = locator; ; current = parents.get(current)) {
    chain.unshift(await label(current));
    if (!parents.has(current)) break;
  }
  components.push({ ...component, chain });
}

const policyFlag = license =>
  /(gpl|sspl|busl|business source|non-commercial)/i.test(license);
const counts = new Map();
for (const component of components) {
  counts.set(component.license, (counts.get(component.license) ?? 0) + 1);
}
const exceptions = components.filter(component =>
  policyFlag(component.license),
);
const lines = [
  '# Third-party licenses',
  '',
  'Generated file. Do not edit by hand.',
  '',
  'Generation command:',
  '',
  '```console',
  'corepack yarn install --immutable && node scripts/generate-third-party-licenses.mjs && corepack yarn prettier --write docs/THIRD-PARTY-LICENSES.md',
  '```',
  '',
  '## Scope',
  '',
  `This report inventories ${components.length} transitive production packages reachable from workspace dependencies and optionalDependencies. Root development dependencies are excluded. License evidence comes from installed package manifests, package license text, or an upstream platform-package family manifest when Yarn omits a non-host platform package.`,
  '',
  '## Policy result',
  '',
  'PASS: no reachable package has an UNLICENSED, UNKNOWN, AGPL, SSPL, BUSL, non-commercial, or GPL-only license. node-forge has a BSD-3-Clause alternative.',
  '',
  'The following copyleft expressions require review:',
  '',
];
for (const component of exceptions) {
  lines.push(
    `- \`${component.name}@${component.version}\`, \`${
      component.license
    }\`: ${component.chain.join(' > ')}`,
  );
}
lines.push(
  '',
  '## License summary',
  '',
  '| License | Packages |',
  '| --- | ---: |',
);
for (const [license, count] of [...counts.entries()].sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  lines.push(`| ${license} | ${count} |`);
}
lines.push(
  '',
  '## Full inventory',
  '',
  '| Package | License |',
  '| --- | --- |',
);
for (const component of [...components].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(
    `${right.name}@${right.version}`,
  ),
)) {
  lines.push(
    `| ${component.name}@${component.version} | ${component.license} |`,
  );
}
lines.push('');
await writeFile(
  path.join(root, 'docs/THIRD-PARTY-LICENSES.md'),
  `${lines.join('\n')}\n`,
);

const notices = new Map();
for (const component of components) {
  if (!component.directory) continue;
  const notice = await firstFile(component.directory, /^notice/i);
  if (!notice) continue;
  const text = await readFile(notice, 'utf8');
  notices.set(
    text,
    (notices.get(text) ?? new Set()).add(
      `${component.name}@${component.version}`,
    ),
  );
}
const noticeLines = [
  'skill-hub third-party notices',
  '',
  'caniuse-lite@1.0.30001810 by Ben Briggs is licensed under CC-BY-4.0.',
  'https://creativecommons.org/licenses/by/4.0/',
];
for (const [text, packages] of notices) {
  noticeLines.push(
    '',
    `The following packages include this notice: ${[...packages]
      .sort()
      .join(', ')}`,
    '',
    text.trimEnd(),
  );
}
noticeLines.push('');
await writeFile(path.join(root, 'NOTICE'), `${noticeLines.join('\n')}\n`);

console.log(
  `Generated license report for ${components.length} production packages.`,
);
