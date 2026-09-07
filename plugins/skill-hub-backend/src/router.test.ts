import { readableBody, refuseUnlessPublished } from './router';
import { RepositoryStatus } from './status';

describe('readableBody', () => {
  it('drops the frontmatter a skill opens with', () => {
    const body = readableBody(
      '---\nname: commit\ndescription: Make commits\n---\n\n# Commit\n\nRunbook.\n',
      'skills/commit/SKILL.md',
    );
    // Markdown renders `---\nname: x\n---` as a setext heading, so leaving it
    // in puts the metadata on the page as if it were prose. The heading is
    // one level down because the page already carries the h1.
    expect(body).toBe('## Commit\n\nRunbook.\n');
  });

  it('leaves the prose of markdown without frontmatter alone', () => {
    expect(readableBody('# Readme\n\nHello.\n', 'README.md')).toBe(
      '## Readme\n\nHello.\n',
    );
  });

  it('fences anything that is not markdown, so a hook reads as code', () => {
    expect(readableBody('def main():\n    pass\n', 'utilities/hooks/stop.py')).toBe(
      '```py\ndef main():\n    pass\n```',
    );
  });

  it('does not mistake a horizontal rule for frontmatter', () => {
    expect(readableBody('# Title\n\n---\n\nMore prose.\n', 'README.md')).toBe(
      '## Title\n\n---\n\nMore prose.\n',
    );
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

describe('readableBody heading levels', () => {
  it('pushes the document down a level, because the page already has an h1', () => {
    expect(
      readableBody('# Commit\n\nProse.\n\n## Steps\n\n### Detail\n', 'a/SKILL.md'),
    ).toBe('## Commit\n\nProse.\n\n### Steps\n\n#### Detail\n');
  });

  it('leaves h6 alone, since there is nothing under it', () => {
    expect(readableBody('###### Deep\n', 'a/README.md')).toBe('###### Deep\n');
  });

  it('does not touch a comment inside a fenced block', () => {
    const body = '# Title\n\n```bash\n# not a heading\ngit status\n```\n\n# Second\n';
    expect(readableBody(body, 'a/README.md')).toBe(
      '## Title\n\n```bash\n# not a heading\ngit status\n```\n\n## Second\n',
    );
  });

  it('leaves a bare hash alone', () => {
    expect(readableBody('#\n#hashtag\n', 'a/README.md')).toBe('#\n#hashtag\n');
  });
});
