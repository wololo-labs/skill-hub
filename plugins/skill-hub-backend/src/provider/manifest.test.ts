import { HARNESSES } from '@internal/plugin-skill-hub-common';
import { ManifestError, parseManifest } from './manifest';

describe('parseManifest', () => {
  it('reads the documented contract', () => {
    const manifest = parseManifest(`
owner: team-ai-platform
system: ai-tooling
publish:
  skills:   skills/*/SKILL.md
  agents:
    - agents/**/*.agent.md
    - agents/*.md
  hooks:    utilities/hooks/*.py
`);

    expect(manifest.owner).toBe('team-ai-platform');
    expect(manifest.system).toBe('ai-tooling');
    expect(manifest.publish.skills).toEqual(['skills/*/SKILL.md']);
    expect(manifest.publish.agents).toEqual([
      'agents/**/*.agent.md',
      'agents/*.md',
    ]);
    // Every harness unless the repository narrows it.
    expect(manifest.harnesses).toEqual(['claude', 'copilot', 'codex']);
  });

  it('narrows the harnesses when asked', () => {
    const manifest = parseManifest(
      'owner: t\nharnesses: [claude]\npublish:\n  skills: s/*/SKILL.md\n',
    );
    expect(manifest.harnesses).toEqual(['claude']);
  });

  it.each([
    ['not YAML at all', 'owner: [unclosed'],
    ['a list rather than a mapping', '- one\n- two'],
    ['no owner', 'publish:\n  skills: s/*/SKILL.md'],
    ['no publish block', 'owner: team'],
    ['an empty publish block', 'owner: team\npublish: {}'],
    [
      'an unknown publish key',
      'owner: team\npublish:\n  widgets: w/*.md',
    ],
    [
      'an unknown harness',
      'owner: team\nharnesses: [emacs]\npublish:\n  skills: s/*/SKILL.md',
    ],
    [
      'a glob that is not a string',
      'owner: team\npublish:\n  skills: 42',
    ],
  ])('rejects a manifest with %s', (_case, raw) => {
    expect(() => parseManifest(raw)).toThrow(ManifestError);
  });

  it('explains what is wrong rather than just failing', () => {
    expect(() =>
      parseManifest('owner: team\npublish:\n  widgets: w/*.md'),
    ).toThrow(/unknown publish key widgets/);
  });
});

describe('which harnesses a repository manifest may name', () => {
  it('are the ones flagged as manifest harnesses, wherever they sit in the list', () => {
    expect(
      HARNESSES.filter(h => 'manifest' in h && h.manifest).map(h => h.id),
    ).toEqual(['claude', 'copilot', 'codex']);
  });

  it('refuses a harness that is not flagged, and says which are allowed', () => {
    expect(() =>
      parseManifest('owner: t\nharnesses: [cursor]\npublish:\n  skills: s/*\n'),
    ).toThrow(/unknown harness cursor, expected one of claude, copilot, codex/);
  });
});
