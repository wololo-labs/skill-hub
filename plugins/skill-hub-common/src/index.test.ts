import {
  APM_ACCEPTED_NOT_OFFERED,
  APM_ALL_TARGETS,
  APM_EXPLICIT_ONLY_TARGETS,
  APM_TARGETS_VERSION,
  HARNESSES,
} from './index';

describe('the targets the hub can name', () => {
  // The targets `apm.yml` accepts at APM_TARGETS_VERSION: every capability in
  // apm_cli/core/target_catalog.py with no experimental flag and not MCP-only,
  // read from the 0.33.0 wheel. `vscode` is an alias of copilot, not a target.
  const APM_STABLE_TARGETS = [
    'agent-skills',
    'antigravity',
    'claude',
    'codex',
    'copilot',
    'cursor',
    'gemini',
    'grok-build',
    'hermes',
    'kiro',
    'opencode',
    'windsurf',
  ];

  it('are exactly the targets APM accepts, at the version they were taken from', () => {
    expect(APM_TARGETS_VERSION).toBe('0.33.0');
    expect(HARNESSES.map(h => h.id).sort()).toEqual(APM_STABLE_TARGETS);
  });
});

describe('the target sets pinned to APM 0.33.0', () => {
  const ids = HARNESSES.map(h => h.id) as string[];

  it('keeps all, explicit-only and not-offered consistent with the hub list', () => {
    // all is every auto-detected target (APM's ALL_CANONICAL_TARGETS), which is
    // the hub's list minus the explicit-only ones.
    expect([...APM_ALL_TARGETS].sort()).toEqual(
      ids.filter(id => !APM_EXPLICIT_ONLY_TARGETS.includes(id)).sort(),
    );
    // Not-offered targets are ones APM accepts and the hub has no command for.
    for (const name of APM_ACCEPTED_NOT_OFFERED) {
      expect(ids).not.toContain(name);
    }
  });
});
