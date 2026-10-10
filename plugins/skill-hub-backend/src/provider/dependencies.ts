import { Entity } from '@backstage/catalog-model';
import {
  ANNOTATION_APM_DEPENDENCIES,
  ANNOTATION_ASSET_PATH,
  ANNOTATION_EVAL_SCORE_REF,
  ANNOTATION_INSTALL_BLOCKED_BY,
  ANNOTATION_REPO,
  InstallBlocker,
  passedGate,
  readEvalScore,
} from '@internal/plugin-skill-hub-common';

/**
 * A package a catalogued package depends on, resolved to the one thing the hub
 * can look up: a repository and a directory inside it.
 */
export interface DependencyTarget {
  /** `owner/repo`, lowercased, because APM matches repositories that way. */
  repo: string;
  /** Directory holding the dependency's `apm.yml`, no leading or trailing slash. */
  dir: string;
}

const GITHUB_URL = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/i;

function cleanDir(dir: string): string {
  return dir.replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

function join(base: string, relative: string): string | undefined {
  const parts = base ? base.split('/') : [];
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

/**
 * What one `dependencies.apm` entry points at, or `undefined` when the hub
 * cannot tell.
 *
 * Only a string or a `git:` object on github.com resolves, plus a local path
 * inside the same repository. A registry id, another host or a path that
 * climbs out of the repository is not looked up and not guessed at: the caller
 * treats `undefined` as a dependency it cannot vouch for.
 */
export function resolveDependency(
  entry: unknown,
  repo: string,
  packageDir: string,
): DependencyTarget | undefined {
  if (typeof entry === 'object' && entry !== null) {
    const { git, path } = entry as { git?: unknown; path?: unknown };
    if (typeof git !== 'string') return undefined;
    const target = resolveDependency(git, repo, packageDir);
    if (!target) return undefined;
    return typeof path === 'string'
      ? { ...target, dir: cleanDir(join(target.dir, path) ?? '') }
      : target;
  }
  if (typeof entry !== 'string' || !entry) return undefined;

  if (/^(\.{1,2}\/|\.{1,2}$)/.test(entry)) {
    const dir = join(packageDir, entry.replace(/#.*$/, ''));
    return dir === undefined ? undefined : { repo: repo.toLowerCase(), dir };
  }
  if (entry.startsWith('/')) return undefined;

  const url = GITHUB_URL.exec(entry);
  if (url) return { repo: `${url[1]}/${url[2]}`.toLowerCase(), dir: '' };
  if (/^[a-z]+:\/\//i.test(entry) || entry.includes('@')) return undefined;

  const segments = entry.replace(/#.*$/, '').split('/').filter(Boolean);
  if (segments[0]?.toLowerCase() === 'github.com') segments.shift();
  // Any other host-looking first segment is a host APM can reach and the hub
  // does not scan.
  if (segments.length < 2 || segments[0].includes('.')) return undefined;
  return {
    repo: `${segments[0]}/${segments[1]}`.toLowerCase(),
    dir: segments.slice(2).join('/'),
  };
}

/** The display form of a dependency, for the page that lists what it pulls in. */
export function dependencyLabel(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry !== null) {
    const { git, id, registry, path } = entry as Record<string, unknown>;
    const name = [git, id, registry].find(v => typeof v === 'string') as
      | string
      | undefined;
    if (name) return typeof path === 'string' ? `${name} (${path})` : name;
  }
  return JSON.stringify(entry);
}

const key = (repo: string, dir: string) => `${repo.toLowerCase()}|${cleanDir(dir)}`;

const systemRef = (entity: Entity) =>
  `system:${entity.metadata.namespace ?? 'default'}/${entity.metadata.name}`;

/**
 * Closes the one way a scored package could still hand over something nobody
 * measured: APM installs a package's own `dependencies.apm` along with it.
 *
 * A package is only as installable as everything it pulls in. Each dependency
 * has to resolve to a package in this catalogue that has itself passed its
 * gate and is not blocked in turn. A dependency the hub cannot find, cannot
 * resolve, or finds unscored or failed blocks the package that names it, and
 * every member that installs as that package.
 *
 * Runs over the whole catalogue because a dependency lives in another
 * repository. It tightens only: it adds a blocker annotation and never
 * removes a score, so a package with no dependencies is untouched. The input
 * entities are copied rather than mutated, because the provider reuses the
 * last good result for a repository that fails to scan.
 */
export function applyDependencyGate(entities: Entity[]): Entity[] {
  type Node = {
    entity: Entity;
    deps: Array<{ label: string; target?: DependencyTarget }>;
  };
  const nodes = new Map<string, Node>();
  const byLocation = new Map<string, string>();

  for (const entity of entities) {
    if (entity.kind !== 'System') continue;
    const annotations = entity.metadata.annotations ?? {};
    const raw = annotations[ANNOTATION_APM_DEPENDENCIES];
    let entries: unknown[] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      // A dependency list the hub cannot read is a dependency it cannot vouch
      // for, so it is treated as one that does not resolve.
      entries = ['(unreadable dependency list)'];
    }
    const repo = annotations[ANNOTATION_REPO] ?? '';
    const dir = annotations[ANNOTATION_ASSET_PATH] ?? '';
    const ref = systemRef(entity);
    nodes.set(ref, {
      entity,
      deps: entries.map(entry => ({
        label: dependencyLabel(entry),
        target: resolveDependency(entry, repo, dir),
      })),
    });
    byLocation.set(key(repo, dir), ref);
  }

  // Start from "every package that passes its own gate is fine" and take
  // packages away until nothing changes. A cycle of packages that all pass
  // therefore stays installable, and a blocker propagates up any chain.
  const blockers = new Map<string, InstallBlocker[]>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [ref, node] of nodes) {
      const found: InstallBlocker[] = [];
      for (const dep of node.deps) {
        const depRef = dep.target
          ? byLocation.get(key(dep.target.repo, dep.target.dir))
          : undefined;
        const depNode = depRef ? nodes.get(depRef) : undefined;
        if (!depNode) {
          found.push({ ref: dep.label, reason: 'unresolved' });
        } else if (!readEvalScore(depNode.entity)) {
          found.push({ ref: dep.label, reason: 'unscored' });
        } else if (!passedGate(readEvalScore(depNode.entity))) {
          found.push({ ref: dep.label, reason: 'failed' });
        } else if (blockers.get(depRef!)?.length) {
          found.push({ ref: dep.label, reason: 'blocked' });
        }
      }
      if (JSON.stringify(found) !== JSON.stringify(blockers.get(ref) ?? [])) {
        blockers.set(ref, found);
        changed = true;
      }
    }
  }

  return entities.map(entity => {
    const own = entity.kind === 'System' ? systemRef(entity) : undefined;
    const via = entity.metadata.annotations?.[ANNOTATION_EVAL_SCORE_REF];
    const found = blockers.get(own ?? via ?? '');
    const annotations = { ...entity.metadata.annotations };
    if (found?.length) {
      annotations[ANNOTATION_INSTALL_BLOCKED_BY] = JSON.stringify(found);
    } else {
      delete annotations[ANNOTATION_INSTALL_BLOCKED_BY];
    }
    return { ...entity, metadata: { ...entity.metadata, annotations } };
  });
}
