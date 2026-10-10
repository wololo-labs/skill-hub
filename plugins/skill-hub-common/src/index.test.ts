import { APM_TARGETS_VERSION, HARNESSES } from './index';

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
