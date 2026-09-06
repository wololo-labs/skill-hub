import { Entity } from '@backstage/catalog-model';
import {
  ANNOTATION_COMMIT,
  ANNOTATION_EVAL_SCORE,
  ANNOTATION_EVAL_SCORE_REF,
  ANNOTATION_INSTALL,
  ANNOTATION_SOURCE_LOCATION,
  readEvalScore,
  readInstallCommands,
  isInstallable,
} from '@internal/plugin-skill-hub-common';
import { RepoRef, TreeEntry } from '../github/GithubAssetReader';
import { buildEntities, publishedPaths } from './entities';
import { parseManifest } from './manifest';

const SHA = 'a'.repeat(40);
const REPO: RepoRef = {
  owner: 'wololo-labs',
  repo: 'estate',
  defaultBranch: 'main',
  archived: false,
};

function repository(files: Record<string, string>) {
  const tree: TreeEntry[] = Object.keys(files).map(path => ({
    path,
    sha: `blob-${path}`,
    type: 'blob',
  }));
  return {
    tree,
    read: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`no blob at ${path}`);
      return content;
    },
  };
}

const find = (entities: Entity[], kind: string, name: string) =>
  entities.find(e => e.kind === kind && e.metadata.name === name);

describe('buildEntities', () => {
  it('turns each publish key into its own spec type, pinned to the commit', async () => {
    const files = {
      'skills/commit/SKILL.md':
        '---\nname: commit\ndescription: Make well formed commits\n---\n\n# Commit\n',
      'agents/engineering/reviewer.agent.md':
        '---\nname: reviewer\ndescription: Reviews a diff\n---\n',
      'utilities/hooks/stop.py':
        '#!/usr/bin/env python3\n"""Runs when the session stops."""\n',
      'prompts/triage.md': '---\ndescription: Triage an incident\n---\n',
      'evals/qe.eval.md': '---\ndescription: The QE benchmark\n---\n',
      'rules/style.md': '---\ndescription: House style\n---\n',
    };
    const manifest = parseManifest(`
owner: team-ai-platform
publish:
  skills:  skills/*/SKILL.md
  agents:  agents/**/*.agent.md
  hooks:   utilities/hooks/*.py
  prompts: prompts/*.md
  evals:   evals/*.eval.md
  rules:   rules/*.md
`);

    const { entities, counts } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest,
      ...repository(files),
    });

    expect(entities.map(e => e.spec?.type).sort()).toEqual([
      'agent',
      'eval-suite',
      'hook',
      'prompt',
      'rule',
      'skill',
    ]);
    expect(counts).toEqual({
      skills: 1,
      agents: 1,
      hooks: 1,
      prompts: 1,
      evals: 1,
      rules: 1,
    });

    const skill = find(entities, 'AiResource', 'commit')!;
    expect(skill.metadata.namespace).toBe('wololo-labs-estate');
    expect(skill.metadata.description).toBe('Make well formed commits');
    expect(skill.spec?.owner).toBe('group:default/team-ai-platform');
    // A skill is a directory of files, so it is addressed as a tree.
    expect(skill.metadata.annotations?.[ANNOTATION_SOURCE_LOCATION]).toBe(
      `url:https://github.com/wololo-labs/estate/tree/${SHA}/skills/commit/`,
    );
    expect(skill.metadata.annotations?.[ANNOTATION_COMMIT]).toBe(SHA);

    // Python has no frontmatter, so the module docstring is the description.
    expect(find(entities, 'AiResource', 'stop')!.metadata.description).toBe(
      'Runs when the session stops.',
    );
  });

  it('has no score, and therefore no install, for a standalone asset', async () => {
    const manifest = parseManifest(
      'owner: team\npublish:\n  skills: skills/*/SKILL.md\n',
    );
    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest,
      ...repository({
        'skills/lonely/SKILL.md': '---\ndescription: On its own\n---\n',
      }),
    });

    const skill = entities[0];
    expect(isInstallable(skill)).toBe(false);
    // A command still exists: the gate is the score, not the absence of a
    // command, and the panel needs something to show once it is scored.
    expect(readInstallCommands(skill).claude).toContain(
      `ainb skill install 'gh:wololo-labs/estate@${SHA}/skills/lonely'`,
    );
  });

  it('gives a pack its score and gives its members the same score and command', async () => {
    const manifest = parseManifest(`
owner: team-ai-platform
publish:
  packages: packages/*/apm.yml
  skills:   packages/*/.apm/skills/*/SKILL.md
`);
    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest,
      ...repository({
        'packages/qe-agent-pack/apm.yml': [
          'name: qe-agent-pack',
          'version: 0.1.0',
          'description: Quality engineering agent pack',
          'keywords: [testing, qe]',
          'dependencies:',
          '  mcp:',
          '    - name: playwright-test',
          '      transport: stdio',
          '      command: npx',
          '      args: ["playwright", "run-test-mcp-server"]',
        ].join('\n'),
        'packages/qe-agent-pack/eval-score.json': JSON.stringify({
          verdict: 'PASS',
          recorded: '2026-09-04',
          metrics: { mutation_kill_rate: { candidate: 0.3, baseline: 0.23 } },
        }),
        'packages/qe-agent-pack/.apm/skills/webapp-testing/SKILL.md':
          '---\ndescription: Drive a local web app\n---\n',
      }),
    });

    const pack = find(entities, 'System', 'qe-agent-pack')!;
    expect(pack.metadata.title).toBe('qe-agent-pack 0.1.0');
    expect(pack.metadata.tags).toEqual(['testing', 'qe']);
    expect(readEvalScore(pack)?.verdict).toBe('PASS');
    expect(isInstallable(pack)).toBe(true);
    expect(readInstallCommands(pack).copilot).toBe(
      `apm install 'wololo-labs/estate/packages/qe-agent-pack#${SHA}' --target copilot`,
    );

    // A member is installed as the pack, and carries the pack's score so the
    // gate is a local check rather than a second lookup.
    const skill = find(entities, 'AiResource', 'webapp-testing')!;
    expect(skill.spec?.system).toBe('qe-agent-pack');
    expect(skill.metadata.annotations?.[ANNOTATION_EVAL_SCORE_REF]).toBe(
      'system:wololo-labs-estate/qe-agent-pack',
    );
    expect(readEvalScore(skill)?.verdict).toBe('PASS');
    expect(readInstallCommands(skill).claude).toBe(
      `apm install 'wololo-labs/estate/packages/qe-agent-pack#${SHA}' --target claude`,
    );

    // The MCP server the pack declares is an API entity, not an AiResource.
    const mcp = find(entities, 'API', 'playwright-test')!;
    expect(mcp.spec?.type).toBe('mcp-server');
    expect(mcp.spec?.system).toBe('qe-agent-pack');
  });

  it('prefers the publisher catalogue for the score, and keeps the commit it was measured at', async () => {
    const measuredAt = 'b'.repeat(40);
    const catalogInfo = [
      'apiVersion: backstage.io/v1alpha1',
      'kind: System',
      'metadata:',
      '  name: qe-agent-pack',
      '  annotations:',
      `    ${ANNOTATION_SOURCE_LOCATION}: url:https://github.com/wololo-labs/estate/tree/${measuredAt}/packages/qe-agent-pack/`,
      `    ${ANNOTATION_EVAL_SCORE}: '{"verdict":"PASS","recorded":"2026-09-04"}'`,
      'spec:',
      '  owner: user:stevengonsalvez',
    ].join('\n');

    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
      ),
      ...repository({
        'packages/qe-agent-pack/apm.yml': 'name: qe-agent-pack\n',
        'packages/qe-agent-pack/catalog-info.yaml': catalogInfo,
        'packages/qe-agent-pack/eval-score.json': '{"verdict":"IGNORED"}',
      }),
    });

    const score = readEvalScore(entities[0])!;
    expect(score.verdict).toBe('PASS');
    // The score was measured somewhere other than the pinned commit, and the
    // detail page has to be able to say so.
    expect(score.measuredCommit).toBe(measuredAt);
  });

  it('reports a repository with zero assets rather than losing it', async () => {
    const { entities, counts } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  skills: nothing/here/*/SKILL.md\n',
      ),
      ...repository({ 'README.md': '# nothing to publish\n' }),
    });

    expect(entities).toEqual([]);
    expect(counts).toEqual({});
  });

  it('keeps the first of two globs that claim the same name, and says so', async () => {
    const { entities, collisions } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  skills:\n    - a/*/SKILL.md\n    - b/*/SKILL.md\n',
      ),
      ...repository({
        'a/tdd/SKILL.md': '---\ndescription: from a\n---\n',
        'b/tdd/SKILL.md': '---\ndescription: from b\n---\n',
      }),
    });

    expect(entities).toHaveLength(1);
    expect(entities[0].metadata.description).toBe('from a');
    expect(collisions).toEqual(['AiResource:wololo-labs-estate/tdd']);
  });

  it('survives an unreadable asset without dropping the rest', async () => {
    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
      ),
      ...repository({
        'packages/broken/apm.yml': 'name: [unclosed',
        'packages/fine/apm.yml': 'name: fine\n',
      }),
    });

    expect(entities.map(e => e.metadata.name)).toEqual(['fine']);
  });
});

describe('publishedPaths', () => {
  it('includes the sidecars a package needs, and nothing else', () => {
    const manifest = parseManifest(
      'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
    );
    const files = [
      'packages/qe/apm.yml',
      'packages/qe/catalog-info.yaml',
      'packages/qe/eval-score.json',
      'packages/qe/README.md',
      'packages/qe/PROOF.md',
      'unrelated.md',
    ];

    expect(publishedPaths(manifest, files).sort()).toEqual([
      'packages/qe/README.md',
      'packages/qe/apm.yml',
      'packages/qe/catalog-info.yaml',
      'packages/qe/eval-score.json',
    ]);
  });
});
