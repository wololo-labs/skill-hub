import { mockServices } from '@backstage/backend-test-utils';
import {
  DeferredEntity,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import {
  GithubAssetReader,
  ManifestFetch,
  RepoRef,
  TreeEntry,
} from '../github/GithubAssetReader';
import { AgentAssetEntityProvider } from './AgentAssetEntityProvider';
import { SkillHubStatus, SkillHubStatusService } from '../status';

const SHA = 'c'.repeat(40);

interface FakeRepo {
  manifest?: string;
  files?: Record<string, string>;
  /** Set to make every read of this repository fail. */
  broken?: boolean;
}

/**
 * A GitHub that only exists in memory. Everything the provider is supposed to
 * survive is expressible here: a repository that never opts in, one whose
 * manifest is nonsense, one that disappears, and an owner that cannot be
 * listed at all.
 */
function fakeReader(estate: Record<string, Record<string, FakeRepo>>) {
  const reader = {
    async listRepositories(owner: string): Promise<RepoRef[]> {
      const repos = estate[owner];
      if (!repos) throw new Error(`no such owner ${owner}`);
      return Object.keys(repos).map(repo => ({
        owner,
        repo,
        defaultBranch: 'main',
        archived: false,
      }));
    },
    async getManifest(repo: RepoRef): Promise<ManifestFetch | undefined> {
      const entry = estate[repo.owner][repo.repo];
      if (entry.broken) throw new Error('Repository access blocked');
      if (!entry.manifest) return undefined;
      return { raw: entry.manifest, commitSha: SHA };
    },
    async getTree(repo: RepoRef): Promise<TreeEntry[]> {
      const files = estate[repo.owner][repo.repo].files ?? {};
      return Object.keys(files).map(path => ({
        path,
        sha: `blob-${repo.repo}-${path}`,
        type: 'blob' as const,
      }));
    },
    async readBlob(repo: RepoRef, blobSha: string): Promise<string> {
      const files = estate[repo.owner][repo.repo].files ?? {};
      const path = blobSha.replace(`blob-${repo.repo}-`, '');
      return files[path];
    },
  };
  return reader as unknown as GithubAssetReader;
}

function fakeStatus(): SkillHubStatusService & { latest: () => SkillHubStatus } {
  let current: SkillHubStatus = {
    owners: [],
    repositoriesScanned: 0,
    entityCount: 0,
    repositories: [],
  };
  return {
    get: () => current,
    set: status => {
      current = status;
    },
    latest: () => current,
  };
}

function fakeConnection() {
  const mutations: DeferredEntity[][] = [];
  const connection = {
    applyMutation: async (mutation: any) => {
      mutations.push(mutation.entities);
    },
    refresh: async () => {},
  } as unknown as EntityProviderConnection;
  return { connection, mutations };
}

const SKILL_MANIFEST = 'owner: team\npublish:\n  skills: skills/*/SKILL.md\n';

describe('AgentAssetEntityProvider', () => {
  const scheduler = { run: async () => {} } as any;

  async function run(estate: Record<string, Record<string, FakeRepo>>) {
    const status = fakeStatus();
    const { connection, mutations } = fakeConnection();
    const provider = new AgentAssetEntityProvider({
      owners: Object.keys(estate),
      reader: fakeReader(estate),
      logger: mockServices.logger.mock(),
      scheduler,
      status,
    });
    await provider.connect(connection);
    await provider.refresh();
    return { status, mutations, provider };
  }

  it('publishes only the repositories that opted in', async () => {
    const { status, mutations } = await run({
      'wololo-labs': {
        'opted-in': {
          manifest: SKILL_MANIFEST,
          files: { 'skills/one/SKILL.md': '---\ndescription: one\n---\n' },
        },
        'never-heard-of-it': {},
      },
    });

    expect(mutations).toHaveLength(1);
    expect(mutations[0].map(e => e.entity.metadata.name)).toEqual(['one']);
    expect(status.latest().repositoriesScanned).toBe(2);
    // A repository with no manifest is the normal state, not a condition to
    // explain, so it is not reported at all.
    expect(status.latest().repositories.map(r => r.repository)).toEqual([
      'wololo-labs/opted-in',
    ]);
  });

  it('skips a malformed manifest with one clear error and finishes the sync', async () => {
    const { status, mutations } = await run({
      'wololo-labs': {
        broken: { manifest: 'owner: [unclosed' },
        healthy: {
          manifest: SKILL_MANIFEST,
          files: { 'skills/two/SKILL.md': '---\ndescription: two\n---\n' },
        },
      },
    });

    // The healthy repository still published.
    expect(mutations[0].map(e => e.entity.metadata.name)).toEqual(['two']);

    const failed = status
      .latest()
      .repositories.find(r => r.repository === 'wololo-labs/broken')!;
    expect(failed.state).toBe('error');
    expect(failed.error).toMatch(/\.agent-assets\.yaml is not usable/);
    expect(status.latest().entityCount).toBe(1);
  });

  it('survives a repository it cannot read at all', async () => {
    const { status, mutations } = await run({
      'wololo-labs': {
        blocked: { broken: true },
        healthy: {
          manifest: SKILL_MANIFEST,
          files: { 'skills/three/SKILL.md': '---\ndescription: three\n---\n' },
        },
      },
    });

    expect(mutations[0]).toHaveLength(1);
    expect(
      status.latest().repositories.find(r => r.repository === 'wololo-labs/blocked')
        ?.error,
    ).toBe('Repository access blocked');
  });

  it('keeps going when a whole owner cannot be listed', async () => {
    const status = fakeStatus();
    const { connection, mutations } = fakeConnection();
    const provider = new AgentAssetEntityProvider({
      owners: ['gone', 'wololo-labs'],
      reader: fakeReader({
        'wololo-labs': {
          healthy: {
            manifest: SKILL_MANIFEST,
            files: { 'skills/four/SKILL.md': '---\ndescription: four\n---\n' },
          },
        },
      }),
      logger: mockServices.logger.mock(),
      scheduler,
      status,
    });
    await provider.connect(connection);
    await provider.refresh();

    expect(mutations[0]).toHaveLength(1);
    expect(
      status.latest().repositories.find(r => r.repository === 'gone')?.error,
    ).toMatch(/could not list repositories/);
  });

  it('carries a repository forward when it cannot be read, rather than unpublishing it', async () => {
    // Access blocked, rate limited, a 5xx: none of these are the repository
    // saying it no longer publishes anything, and the mutation is
    // authoritative, so treating them as removals would empty the catalogue
    // one outage at a time.
    const estate: Record<string, Record<string, FakeRepo>> = {
      'wololo-labs': {
        healthy: {
          manifest: SKILL_MANIFEST,
          files: { 'skills/four/SKILL.md': '---\ndescription: four\n---\n' },
        },
      },
    };
    const status = fakeStatus();
    const { connection, mutations } = fakeConnection();
    const provider = new AgentAssetEntityProvider({
      owners: ['wololo-labs'],
      reader: fakeReader(estate),
      logger: mockServices.logger.mock(),
      scheduler,
      status,
    });
    await provider.connect(connection);
    await provider.refresh();
    expect(mutations[0]).toHaveLength(1);

    estate['wololo-labs'].healthy.broken = true;
    await provider.refresh();

    expect(mutations[1]).toHaveLength(1);
    expect(
      status.latest().repositories.find(r => r.repository === 'wololo-labs/healthy')
        ?.state,
    ).toBe('error');
  });

  it('leaves the catalogue alone when a run finds nothing and something failed', async () => {
    // Everything the last run published is gone from this one, but a
    // repository also errored, so the run cannot tell an unpublish apart from
    // a failure. It declines to guess, and the catalogue keeps what it has.
    const estate: Record<string, Record<string, FakeRepo>> = {
      'wololo-labs': {
        healthy: {
          manifest: SKILL_MANIFEST,
          files: { 'skills/four/SKILL.md': '---\ndescription: four\n---\n' },
        },
        quiet: {},
      },
    };
    const status = fakeStatus();
    const { connection, mutations } = fakeConnection();
    const provider = new AgentAssetEntityProvider({
      owners: ['wololo-labs'],
      reader: fakeReader(estate),
      logger: mockServices.logger.mock(),
      scheduler,
      status,
    });
    await provider.connect(connection);
    await provider.refresh();
    expect(mutations).toHaveLength(1);

    // The one publisher removes its manifest, and a repository that never
    // published anything starts failing in the same run.
    delete estate['wololo-labs'].healthy.manifest;
    estate['wololo-labs'].quiet.broken = true;
    await provider.refresh();

    expect(mutations).toHaveLength(1);
    expect(status.latest().lastRunError).toMatch(/treated as a failure/);
    expect(status.latest().entityCount).toBe(1);
  });

  it('unpublishes a repository that removes its manifest', async () => {
    const estate: Record<string, Record<string, FakeRepo>> = {
      'wololo-labs': {
        'opted-in': {
          manifest: SKILL_MANIFEST,
          files: { 'skills/five/SKILL.md': '---\ndescription: five\n---\n' },
        },
      },
    };
    const status = fakeStatus();
    const { connection, mutations } = fakeConnection();
    const provider = new AgentAssetEntityProvider({
      owners: ['wololo-labs'],
      reader: fakeReader(estate),
      logger: mockServices.logger.mock(),
      scheduler,
      status,
    });
    await provider.connect(connection);
    await provider.refresh();
    expect(mutations[0]).toHaveLength(1);

    // The repository opts back out.
    delete estate['wololo-labs']['opted-in'].manifest;
    await provider.refresh();

    // The provider is authoritative for what it emitted, so a full mutation
    // with no entities is what removes them.
    expect(mutations[1]).toEqual([]);
    expect(status.latest().entityCount).toBe(0);
  });

  it('records what it published, per repository', async () => {
    const { status } = await run({
      'wololo-labs': {
        estate: {
          manifest:
            'owner: team\npublish:\n  skills: skills/*/SKILL.md\n  hooks: hooks/*.py\n',
          files: {
            'skills/six/SKILL.md': '---\ndescription: six\n---\n',
            'hooks/stop.py': '"""Stops."""\n',
          },
        },
      },
    });

    const published = status.latest().repositories[0];
    expect(published.state).toBe('published');
    expect(published.commit).toBe(SHA);
    expect(published.assets).toEqual({ skills: 1, hooks: 1 });
    expect(published.entityCount).toBe(2);
    expect(status.latest().lastRunDurationMs).toBeGreaterThanOrEqual(0);
  });
});
