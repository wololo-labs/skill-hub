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
          if (!(path in files)) throw Object.assign(new Error('Not Found'), { status: 404 });
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
