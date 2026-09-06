import { readableBody, refuseUnlessPublished } from './router';
import { RepositoryStatus } from './status';

describe('readableBody', () => {
  it('drops the frontmatter a skill opens with', () => {
    const body = readableBody(
      '---\nname: commit\ndescription: Make commits\n---\n\n# Commit\n\nRunbook.\n',
      'skills/commit/SKILL.md',
    );
    // Markdown renders `---\nname: x\n---` as a setext heading, so leaving it
    // in puts the metadata on the page as if it were prose.
    expect(body).toBe('# Commit\n\nRunbook.\n');
  });

  it('leaves markdown without frontmatter alone', () => {
    expect(readableBody('# Readme\n\nHello.\n', 'README.md')).toBe(
      '# Readme\n\nHello.\n',
    );
  });

  it('fences anything that is not markdown, so a hook reads as code', () => {
    expect(readableBody('def main():\n    pass\n', 'utilities/hooks/stop.py')).toBe(
      '```py\ndef main():\n    pass\n```',
    );
  });

  it('does not mistake a horizontal rule for frontmatter', () => {
    const body = '# Title\n\n---\n\nMore prose.\n';
    expect(readableBody(body, 'README.md')).toBe(body);
  });
});

describe('refuseUnlessPublished', () => {
  const published: RepositoryStatus[] = [
    {
      repository: 'wololo-labs/estate',
      state: 'published',
      commit: 'a'.repeat(40),
    },
    { repository: 'wololo-labs/broken', state: 'error', error: 'nope' },
  ];
  const good = {
    repo: 'wololo-labs/estate',
    commit: 'a'.repeat(40),
    path: 'skills/commit/SKILL.md',
    assetPath: 'skills/commit',
  };

  it('allows the body of an asset the provider published', () => {
    expect(refuseUnlessPublished(good, published)).toBeUndefined();
  });

  it('allows an asset addressed by its own file', () => {
    expect(
      refuseUnlessPublished(
        { ...good, path: 'hooks/stop.py', assetPath: 'hooks/stop.py' },
        published,
      ),
    ).toBeUndefined();
  });

  it('refuses a repository the provider never published', () => {
    // The attack this exists to stop: register a catalogue location whose
    // entity points at a private repository, and read it through the hub's
    // own token.
    expect(
      refuseUnlessPublished({ ...good, repo: 'wololo-labs/secrets' }, published),
    ).toMatch(/not one the provider published/);
  });

  it('refuses a repository whose manifest failed', () => {
    expect(
      refuseUnlessPublished({ ...good, repo: 'wololo-labs/broken' }, published),
    ).toMatch(/not one the provider published/);
  });

  it('refuses anything that is not a full commit sha', () => {
    for (const commit of ['main', 'HEAD', 'a'.repeat(7), '../../etc']) {
      expect(refuseUnlessPublished({ ...good, commit }, published)).toMatch(
        /not a full sha/,
      );
    }
  });

  it('refuses a file outside the asset', () => {
    for (const path of ['.env', 'skills/other/SKILL.md', 'skills/commitment/x']) {
      expect(refuseUnlessPublished({ ...good, path }, published)).toMatch(
        /outside the asset/,
      );
    }
  });

  it('refuses an entity carrying no asset path at all', () => {
    expect(
      refuseUnlessPublished({ ...good, assetPath: undefined }, published),
    ).toMatch(/outside the asset/);
  });
});
