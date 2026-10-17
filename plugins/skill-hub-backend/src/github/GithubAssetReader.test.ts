import { mockServices } from '@backstage/backend-test-utils';
import { GithubAssetReader } from './GithubAssetReader';

const REPO = {
  owner: 'wololo-labs',
  repo: 'estate',
  defaultBranch: 'main',
  archived: false,
};

/** An Octokit holding only the root files a repository really has. */
function readerWith(files: Record<string, string>) {
  const asked: string[] = [];
  const octokit = {
    rest: {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          asked.push(path);
          if (!(path in files))
            throw Object.assign(new Error('Not Found'), { status: 404 });
          return { data: files[path], headers: {} };
        },
      },
      git: {
        getRef: async () => ({ data: { object: { sha: 'a'.repeat(40) } } }),
      },
    },
  };
  const reader = new GithubAssetReader({
    octokit: octokit as any,
    logger: mockServices.logger.mock(),
  });
  return { reader, asked };
}

describe('GithubAssetReader.getManifest', () => {
  it('finds a repository by its root apm.yml', async () => {
    const { reader } = readerWith({ 'apm.yml': 'name: p\n' });
    expect(await reader.getManifest(REPO)).toEqual({
      path: 'apm.yml',
      raw: 'name: p\n',
      commitSha: 'a'.repeat(40),
    });
  });

  it('prefers the legacy manifest, and does not look for apm.yml once it has one', async () => {
    const { reader, asked } = readerWith({
      '.agent-assets.yaml': 'owner: team\n',
      'apm.yml': 'name: p\n',
    });
    expect((await reader.getManifest(REPO))?.path).toBe('.agent-assets.yaml');
    expect(asked).toEqual(['.agent-assets.yaml']);
  });

  it('returns undefined for a repository that declares neither', async () => {
    const { reader } = readerWith({});
    expect(await reader.getManifest(REPO)).toBeUndefined();
  });
});

describe('GithubAssetReader.getManifest caching', () => {
  /** An Octokit whose getContent is scripted call by call. */
  function scripted(calls: Array<(args: any) => unknown>) {
    const seen: any[] = [];
    const octokit = {
      rest: {
        repos: {
          getContent: async (args: any) => {
            seen.push(args);
            const next = calls.shift();
            if (!next)
              throw Object.assign(new Error('Not Found'), { status: 404 });
            return next(args);
          },
        },
        git: {
          getRef: async () => ({ data: { object: { sha: 'a'.repeat(40) } } }),
        },
      },
    };
    const reader = new GithubAssetReader({
      octokit: octokit as any,
      logger: mockServices.logger.mock(),
    });
    return { reader, seen };
  }

  const notFound = () => {
    throw Object.assign(new Error('Not Found'), { status: 404 });
  };

  it('sends the etag it was given and reuses the file on a 304', async () => {
    const { reader, seen } = scripted([
      notFound, // .agent-assets.yaml, first scan
      () => ({ data: 'name: p\n', headers: { etag: 'W/"1"' } }), // apm.yml
      notFound, // .agent-assets.yaml, second scan
      () => {
        throw Object.assign(new Error('Not Modified'), { status: 304 });
      },
    ]);

    await reader.getManifest(REPO);
    const again = await reader.getManifest(REPO);

    expect(again).toMatchObject({ path: 'apm.yml', raw: 'name: p\n' });
    expect(seen[3].headers['if-none-match']).toBe('W/"1"');
    // A file that was never seen has nothing to be conditional on.
    expect(seen[2].headers['if-none-match']).toBeUndefined();
  });

  it('does not treat a failure other than a 404 as the repository having no manifest', async () => {
    const { reader } = scripted([
      () => {
        throw Object.assign(new Error('Server Error'), { status: 500 });
      },
    ]);
    await expect(reader.getManifest(REPO)).rejects.toThrow('Server Error');
  });
});

describe('GithubAssetReader.listRepositories', () => {
  const repoRow = { name: 'estate', default_branch: 'main', archived: false };
  const status = (code: number) => () => {
    throw Object.assign(new Error(`HTTP ${code}`), { status: code });
  };

  /**
   * An Octokit whose org and user endpoints are scripted call by call. The
   * paginator is reduced to a single page, which is all these cases need.
   */
  function listing(
    org: Array<(args: any) => unknown>,
    user: Array<(args: any) => unknown> = [],
  ) {
    const orgCalls: any[] = [];
    const userCalls: any[] = [];
    const endpoint =
      (script: Array<(args: any) => unknown>, seen: any[]) => (args: any) => {
        seen.push(args);
        return script.shift()!(args);
      };
    const listForOrg = endpoint(org, orgCalls);
    const listForUser = endpoint(user, userCalls);
    const octokit = {
      paginate: {
        iterator: (fn: (args: any) => unknown, args: any) =>
          (async function* () {
            yield await fn(args);
          })(),
      },
      rest: { repos: { listForOrg, listForUser } },
    };
    const reader = new GithubAssetReader({
      octokit: octokit as any,
      logger: mockServices.logger.mock(),
    });
    return { reader, orgCalls, userCalls };
  }

  const page = (etag?: string) => () => ({
    data: [repoRow],
    headers: etag ? { etag } : {},
  });

  it('marks the repositories of an organisation as Organization owned', async () => {
    const { reader, userCalls } = listing([page()]);
    const repos = await reader.listRepositories('wololo-labs');
    expect(repos).toEqual([
      expect.objectContaining({ repo: 'estate', ownerKind: 'Organization' }),
    ]);
    expect(userCalls).toHaveLength(0);
  });

  it('falls back to the user endpoint on a 404 and marks the repositories User owned', async () => {
    const { reader, orgCalls, userCalls } = listing([status(404)], [page()]);
    const repos = await reader.listRepositories('stevengonsalvez');
    expect(repos).toEqual([
      expect.objectContaining({ repo: 'estate', ownerKind: 'User' }),
    ]);
    expect(orgCalls[0].org).toBe('stevengonsalvez');
    expect(userCalls[0].username).toBe('stevengonsalvez');
  });

  it('does not fall back to the user endpoint on a failure other than a 404', async () => {
    const { reader, userCalls } = listing([status(500)]);
    await expect(reader.listRepositories('wololo-labs')).rejects.toThrow(
      'HTTP 500',
    );
    expect(userCalls).toHaveLength(0);
  });

  it('replays the cached list when the etag it sent answers 304', async () => {
    const { reader, orgCalls } = listing([page('W/"1"'), status(304)]);
    const first = await reader.listRepositories('wololo-labs');
    const again = await reader.listRepositories('wololo-labs');

    expect(again).toEqual(first);
    expect(again[0].ownerKind).toBe('Organization');
    expect(orgCalls[0].headers).toBeUndefined();
    expect(orgCalls[1].headers).toEqual({ 'if-none-match': 'W/"1"' });
  });

  it('replays a cached user list on a 304 after the org endpoint 404s again', async () => {
    const { reader, orgCalls, userCalls } = listing(
      [status(404), status(404)],
      [page('W/"2"'), status(304)],
    );
    const first = await reader.listRepositories('stevengonsalvez');
    const again = await reader.listRepositories('stevengonsalvez');

    expect(again).toEqual(first);
    expect(again[0].ownerKind).toBe('User');
    expect(userCalls[1].headers).toEqual({ 'if-none-match': 'W/"2"' });
    expect(orgCalls).toHaveLength(2);
  });
});
