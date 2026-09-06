import { readableBody } from './router';

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
