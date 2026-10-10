import { Entity } from '@backstage/catalog-model';
import {
  ANNOTATION_APM_DEPENDENCIES,
  ANNOTATION_ASSET_PATH,
  ANNOTATION_EVAL_SCORE,
  ANNOTATION_EVAL_SCORE_REF,
  ANNOTATION_INSTALL_BLOCKED_BY,
  ANNOTATION_REPO,
  isInstallable,
  readInstallBlockers,
} from '@internal/plugin-skill-hub-common';
import { TreeEntry } from '../github/GithubAssetReader';
import { applyDependencyGate, resolveDependency } from './dependencies';
import { buildEntities } from './entities';
import { parseManifest } from './manifest';

const PASS = { verdict: 'PASS' };
const FAIL = { verdict: 'REGRESSION' };

const namespace = (repo: string) => repo.replace('/', '-').toLowerCase();

function pack(
  repo: string,
  dir: string,
  name: string,
  opts: { score?: object; deps?: unknown; rawDeps?: string } = {},
): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'System',
    metadata: {
      name,
      namespace: namespace(repo),
      annotations: {
        [ANNOTATION_REPO]: repo,
        [ANNOTATION_ASSET_PATH]: dir,
        ...(opts.score
          ? { [ANNOTATION_EVAL_SCORE]: JSON.stringify(opts.score) }
          : {}),
        ...(opts.deps !== undefined
          ? { [ANNOTATION_APM_DEPENDENCIES]: JSON.stringify(opts.deps) }
          : {}),
        ...(opts.rawDeps ? { [ANNOTATION_APM_DEPENDENCIES]: opts.rawDeps } : {}),
      },
    },
    spec: { owner: 'team' },
  };
}

/** A skill that installs as the pack, and so carries the pack's score. */
function member(of: Entity): Entity {
  const ref = `system:${of.metadata.namespace}/${of.metadata.name}`;
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'AiResource',
    metadata: {
      name: `${of.metadata.name}-skill`,
      namespace: of.metadata.namespace,
      annotations: {
        [ANNOTATION_EVAL_SCORE_REF]: ref,
        ...(of.metadata.annotations?.[ANNOTATION_EVAL_SCORE]
          ? {
              [ANNOTATION_EVAL_SCORE]:
                of.metadata.annotations[ANNOTATION_EVAL_SCORE],
            }
          : {}),
      },
    },
    spec: { type: 'skill', owner: 'team' },
  };
}

const gated = (entities: Entity[]) => {
  const out = applyDependencyGate(entities);
  return (name: string) => out.find(e => e.metadata.name === name)!;
};

describe('resolveDependency', () => {
  const from = 'Acme/Estate';

  it.each([
    ['acme/shared', { repo: 'acme/shared', dir: '' }],
    ['acme/shared#v1.2.0', { repo: 'acme/shared', dir: '' }],
    ['Acme/Shared/packs/qe#abc123', { repo: 'acme/shared', dir: 'packs/qe' }],
    ['github.com/acme/shared/packs/qe', { repo: 'acme/shared', dir: 'packs/qe' }],
    ['https://github.com/acme/shared.git', { repo: 'acme/shared', dir: '' }],
    ['git@github.com:acme/shared.git', { repo: 'acme/shared', dir: '' }],
    ['./sibling', { repo: 'acme/estate', dir: 'packages/sibling' }],
    ['../other/pack', { repo: 'acme/estate', dir: 'packages/other/pack' }],
    [
      { git: 'https://github.com/acme/shared.git', path: 'packs/qe' },
      { repo: 'acme/shared', dir: 'packs/qe' },
    ],
  ])('resolves %j', (entry, expected) => {
    expect(resolveDependency(entry, from, 'packages/a')).toEqual(expected);
  });

  it.each([
    ['a registry id', { id: 'some/pack', version: '^1.0.0' }],
    ['another host', 'https://gitlab.com/acme/shared.git'],
    ['an ssh url on another host', 'git@gitlab.com:acme/shared.git'],
    ['a host-qualified shorthand', 'gitlab.com/acme/shared'],
    ['an absolute path', '/etc/pack'],
    ['a path out of the repository', '../../../elsewhere'],
    ['a bare name', 'shared'],
    ['an empty string', ''],
    ['a number', 7],
  ])('does not guess at %s', (_label, entry) => {
    expect(resolveDependency(entry, from, 'packages/a')).toBeUndefined();
  });
});

describe('applyDependencyGate', () => {
  it('leaves a package with no dependencies alone', () => {
    const solo = pack('acme/a', 'packs/solo', 'solo', { score: PASS });
    const out = gated([solo, member(solo)]);

    expect(readInstallBlockers(out('solo'))).toEqual([]);
    expect(isInstallable(out('solo'))).toBe(true);
    expect(isInstallable(out('solo-skill'))).toBe(true);
  });

  it('lets a package through when everything it pulls in has passed', () => {
    const lib = pack('acme/lib', '', 'lib', { score: PASS });
    const top = pack('acme/a', 'packs/top', 'top', {
      score: PASS,
      deps: ['acme/lib#v1'],
    });

    expect(isInstallable(gated([lib, top])('top'))).toBe(true);
  });

  it('blocks a passing package whose dependency is unscored, and every member of it', () => {
    const lib = pack('acme/lib', '', 'lib');
    const top = pack('acme/a', 'packs/top', 'top', {
      score: PASS,
      deps: ['acme/lib'],
    });
    const out = gated([lib, top, member(top)]);

    expect(readInstallBlockers(out('top'))).toEqual([
      { ref: 'acme/lib', reason: 'unscored' },
    ]);
    expect(isInstallable(out('top'))).toBe(false);
    // The member installs as the pack, so it is held back the same way.
    expect(isInstallable(out('top-skill'))).toBe(false);
  });

  it('blocks on a dependency whose own gate failed', () => {
    const lib = pack('acme/lib', '', 'lib', { score: FAIL });
    const top = pack('acme/a', '', 'top', { score: PASS, deps: ['acme/lib'] });

    expect(readInstallBlockers(gated([lib, top])('top'))).toEqual([
      { ref: 'acme/lib', reason: 'failed' },
    ]);
  });

  it('blocks on a dependency the catalogue has never seen', () => {
    const top = pack('acme/a', '', 'top', {
      score: PASS,
      deps: ['acme/missing', { id: 'registry/pack', version: '1' }],
    });

    expect(readInstallBlockers(gated([top])('top'))).toEqual([
      { ref: 'acme/missing', reason: 'unresolved' },
      { ref: 'registry/pack', reason: 'unresolved' },
    ]);
  });

  it('carries a block up a chain of packages', () => {
    const c = pack('acme/c', '', 'c');
    const b = pack('acme/b', '', 'b', { score: PASS, deps: ['acme/c'] });
    const a = pack('acme/a', '', 'a', { score: PASS, deps: ['acme/b'] });
    const out = gated([a, b, c]);

    expect(readInstallBlockers(out('b'))).toEqual([
      { ref: 'acme/c', reason: 'unscored' },
    ]);
    expect(readInstallBlockers(out('a'))).toEqual([
      { ref: 'acme/b', reason: 'blocked' },
    ]);
  });

  it('does not block two passing packages for depending on each other', () => {
    const a = pack('acme/a', '', 'a', { score: PASS, deps: ['acme/b'] });
    const b = pack('acme/b', '', 'b', { score: PASS, deps: ['acme/a'] });
    const out = gated([a, b]);

    expect(isInstallable(out('a'))).toBe(true);
    expect(isInstallable(out('b'))).toBe(true);
  });

  it('resolves a sibling package in the same repository by relative path', () => {
    const sibling = pack('acme/mono', 'packages/sibling', 'sibling', {
      score: PASS,
    });
    const top = pack('acme/mono', 'packages/top', 'top', {
      score: PASS,
      deps: ['../sibling'],
    });

    expect(isInstallable(gated([sibling, top])('top'))).toBe(true);
  });

  it('treats a dependency list it cannot read as a dependency it cannot vouch for', () => {
    const garbled = pack('acme/a', '', 'garbled', {
      score: PASS,
      rawDeps: '{not json',
    });

    const out = gated([garbled])('garbled');
    expect(isInstallable(out)).toBe(false);
    expect(readInstallBlockers(out)[0].reason).toBe('unresolved');
  });

  it('never makes an unscored package installable', () => {
    const lib = pack('acme/lib', '', 'lib', { score: PASS });
    const top = pack('acme/a', '', 'top', { deps: ['acme/lib'] });

    expect(isInstallable(gated([lib, top])('top'))).toBe(false);
  });

  it('clears a block once the dependency has passed, and does not mutate its input', () => {
    const top = pack('acme/a', '', 'top', { score: PASS, deps: ['acme/lib'] });

    const blocked = applyDependencyGate([pack('acme/lib', '', 'lib'), top]);
    expect(isInstallable(blocked.find(e => e.metadata.name === 'top')!)).toBe(
      false,
    );
    // The provider reuses the last good result for a repository that fails to
    // scan, so a stored entity must not have picked the block up.
    expect(
      top.metadata.annotations?.[ANNOTATION_INSTALL_BLOCKED_BY],
    ).toBeUndefined();

    // Feed the blocked copy back in, as a carried-forward entity would be.
    const stale = blocked.find(e => e.metadata.name === 'top')!;
    const lib = pack('acme/lib', '', 'lib', { score: PASS });
    const healed = applyDependencyGate([lib, stale]).find(
      e => e.metadata.name === 'top',
    )!;
    expect(isInstallable(healed)).toBe(true);
    expect(
      healed.metadata.annotations?.[ANNOTATION_INSTALL_BLOCKED_BY],
    ).toBeUndefined();
  });
});

describe('the gate end to end from an apm.yml', () => {
  const files = (apmYaml: string) => {
    const content: Record<string, string> = {
      'packages/top/apm.yml': apmYaml,
      'packages/top/eval-score.json': '{"verdict":"PASS"}',
    };
    const tree: TreeEntry[] = Object.keys(content).map(path => ({
      path,
      sha: path,
      type: 'blob',
    }));
    return { tree, read: async (path: string) => content[path] };
  };

  const build = async (apmYaml: string) => {
    const { entities } = await buildEntities({
      repo: { owner: 'acme', repo: 'estate', defaultBranch: 'main', archived: false },
      commitSha: 'a'.repeat(40),
      manifest: parseManifest(
        'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
      ),
      ...files(apmYaml),
    });
    return entities;
  };

  it('records what dependencies.apm pulls in, and blocks on an unknown one', async () => {
    const entities = await build(
      'name: top\ndependencies:\n  apm:\n    - acme/lib#v1\n    - git: https://github.com/acme/other.git\n',
    );
    const system = entities.find(e => e.kind === 'System')!;

    expect(
      JSON.parse(system.metadata.annotations![ANNOTATION_APM_DEPENDENCIES]),
    ).toEqual(['acme/lib#v1', { git: 'https://github.com/acme/other.git' }]);
    expect(isInstallable(applyDependencyGate(entities)[0])).toBe(false);
  });

  it('records nothing for a package with no apm dependencies', async () => {
    const [system] = await build('name: top\ndependencies:\n  apm: []\n');
    expect(
      system.metadata.annotations?.[ANNOTATION_APM_DEPENDENCIES],
    ).toBeUndefined();
    expect(isInstallable(applyDependencyGate([system])[0])).toBe(true);
  });

  it('records an unreadable dependency list as one the hub cannot vouch for', async () => {
    const [system] = await build('name: top\ndependencies:\n  apm: not-a-list\n');
    expect(isInstallable(applyDependencyGate([system])[0])).toBe(false);
  });
});
