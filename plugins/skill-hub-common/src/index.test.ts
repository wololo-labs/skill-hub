import {
  APM_ACCEPTED_NOT_OFFERED,
  APM_ALL_TARGETS,
  APM_EXPLICIT_ONLY_TARGETS,
  APM_TARGETS_VERSION,
  describeBaseline,
  describeChange,
  describeConfidence,
  describeOrigin,
  describeVerdict,
  EvalScore,
  HARNESSES,
  isScoreStale,
  passedGate,
  readEvalScore,
  scoreState,
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

const stats = (significantImprovement: boolean) => ({
  meanDelta: 0.0003,
  ciLow: -0.01,
  ciHigh: 0.01,
  confidence: 0.95,
  significantImprovement,
});

describe('scoreState', () => {
  it('is a gain only for a pass with a significant improvement', () => {
    expect(
      scoreState({
        verdict: 'PASS',
        origin: 'gate-report',
        stats: stats(true),
      }),
    ).toBe('gain');
  });

  it('reads a pass that is measurably worse as regressed, and not installable', () => {
    const score = {
      verdict: 'PASS',
      stats: { ...stats(false), significantRegression: true },
    };
    expect(scoreState(score)).toBe('regressed');
    expect(passedGate(score)).toBe(false);
  });

  it.each([
    ['a hand-written eval-score.json', 'eval-score'],
    ['a catalogue file', 'catalogue'],
    ['a score of unknown origin', undefined],
  ] as const)('never reads a gain claimed by %s as one', (_, origin) => {
    // Only a gate run can show an improvement. Anything else can say it passed,
    // not that it beats the model alone.
    expect(scoreState({ verdict: 'PASS', origin, stats: stats(true) })).toBe(
      'no-gain',
    );
  });

  it('is no demonstrated gain for a pass without one', () => {
    expect(scoreState({ verdict: 'PASS', stats: stats(false) })).toBe(
      'no-gain',
    );
  });

  it('never reads a pass with no statistics as a gain', () => {
    expect(scoreState({ verdict: 'PASS' })).toBe('no-gain');
    expect(scoreState({ verdict: 'pass', stats: {} })).toBe('no-gain');
  });

  it('is regressed for a regression verdict, whatever the flag says', () => {
    expect(scoreState({ verdict: 'REGRESSION', stats: stats(true) })).toBe(
      'regressed',
    );
  });

  it('keeps every other non-pass verdict as a failure, not a pass', () => {
    expect(scoreState({ verdict: 'REFUSED' })).toBe('failed');
    expect(scoreState({})).toBe('failed');
  });

  it('is unscored when there is no report', () => {
    expect(scoreState(undefined)).toBe('unscored');
  });
});

describe('isScoreStale', () => {
  const score = (measuredCommit?: string): EvalScore => ({
    verdict: 'PASS',
    measuredCommit,
  });

  it('is stale when the commits differ', () => {
    expect(isScoreStale(score('a'.repeat(40)), 'b'.repeat(40))).toBe(true);
  });

  it('is not stale when one is a prefix of the other', () => {
    expect(isScoreStale(score('abc1234'), `abc1234${'f'.repeat(33)}`)).toBe(
      false,
    );
  });

  it('is not stale when either side is unknown', () => {
    expect(isScoreStale(score(undefined), 'b'.repeat(40))).toBe(false);
    expect(isScoreStale(score('a'.repeat(40)), undefined)).toBe(false);
    expect(isScoreStale(undefined, 'b'.repeat(40))).toBe(false);
  });
});

describe('readEvalScore on a legacy or hand-written score', () => {
  const entityWith = (raw: unknown) =>
    ({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'System',
      metadata: {
        name: 'x',
        annotations: { 'wololo.dev/eval-score': JSON.stringify(raw) },
      },
    } as any);

  it('keeps only values of the right type, so no surface has to guard', () => {
    const score = readEvalScore(
      entityWith({
        verdict: 7,
        recorded: 20261009,
        measuredCommit: 1234567,
        metrics: {
          ok: { candidate: 0.5, baseline: 0.4 },
          text: { candidate: 'n/a', baseline: '0.4' },
          junk: { candidate: { x: 1 }, baseline: null },
        },
        stats: { ciLow: 'low', ciHigh: 0.1, significantImprovement: 'yes' },
      }),
    )!;
    expect(score.verdict).toBeUndefined();
    expect(score.recorded).toBeUndefined();
    expect(score.measuredCommit).toBe('1234567');
    expect(Object.keys(score.metrics!)).toEqual(['ok', 'text']);
    expect(score.stats).toEqual({ ciHigh: 0.1 });
  });

  it('never throws when asked whether a hand-written score is stale', () => {
    const score = readEvalScore(
      entityWith({ verdict: 'PASS', measuredCommit: 1234567 }),
    );
    expect(() => isScoreStale(score, 'abc1234')).not.toThrow();
  });
});

describe('describeChange', () => {
  const ci = { ciLow: 0.021, ciHigh: 0.084, confidence: 0.95 };

  it('states the change, signed, with its interval when the confidence is given', () => {
    expect(describeChange({ meanDelta: 0.052, ...ci })).toBe(
      '+0.0520 (0.0210 to 0.0840)',
    );
    expect(
      describeChange({
        meanDelta: -0.061,
        ciLow: -0.09,
        ciHigh: -0.03,
        confidence: 0.9,
      }),
    ).toBe('-0.0610 (-0.0900 to -0.0300)');
  });

  it('does not round a small significant gain down to zero', () => {
    expect(
      describeChange({
        meanDelta: 0.0004,
        ciLow: 0.0002,
        ciHigh: 0.0006,
        confidence: 0.95,
      }),
    ).toBe('+0.0004 (0.0002 to 0.0006)');
  });

  it.each([undefined, 0, 1, 1.5, -0.2])(
    'shows no interval when the confidence is %s, rather than assuming one',
    confidence => {
      expect(
        describeChange({
          meanDelta: 0.052,
          ciLow: 0.021,
          ciHigh: 0.084,
          confidence,
        }),
      ).toBe('+0.0520');
    },
  );

  it('says unrecorded when the mean is missing, never a blank', () => {
    expect(describeChange(ci)).toBe('unrecorded (0.0210 to 0.0840)');
  });

  it('gives the mean alone when there is no interval, and nothing when there is neither', () => {
    expect(describeChange({ meanDelta: 0.1 })).toBe('+0.1000');
    expect(describeChange({})).toBeUndefined();
    expect(describeChange(undefined)).toBeUndefined();
  });
});

describe('describeConfidence', () => {
  it('names the level only when the report states a usable one', () => {
    expect(describeConfidence({ confidence: 0.95 })).toBe('95% interval');
    expect(describeConfidence({ confidence: 0.9 })).toBe('90% interval');
    for (const confidence of [undefined, 0, 1, 2]) {
      expect(describeConfidence({ confidence })).toBeUndefined();
    }
  });
});

describe('describeBaseline', () => {
  it("says the gate's baseline unless the report states a no-skill one", () => {
    expect(describeBaseline({ verdict: 'PASS' })).toBe("the gate's baseline");
    expect(
      describeBaseline({ verdict: 'PASS', baselineKind: 'no-skill' }),
    ).toBe('the model alone');
  });

  it('reads the kind from a report and ignores a value it does not know', () => {
    const read = (baselineKind: unknown) =>
      readEvalScore({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'System',
        metadata: {
          name: 'x',
          annotations: {
            'wololo.dev/eval-score': JSON.stringify({
              verdict: 'PASS',
              baselineKind,
            }),
          },
        },
      } as any)!;
    expect(describeBaseline(read('no-skill'))).toBe('the model alone');
    expect(describeBaseline(read('something'))).toBe("the gate's baseline");
  });
});

describe('one definition of a passed gate', () => {
  const scores: Array<EvalScore | undefined> = [
    undefined,
    {},
    { verdict: 'pass' },
    {
      verdict: 'PASS',
      origin: 'gate-report',
      stats: { significantImprovement: true },
    },
    { verdict: 'PASS', stats: { significantRegression: true } },
    { verdict: 'REGRESSION' },
    { verdict: 'REFUSED' },
  ];

  it('is a gain or no-gain exactly when the install gate passes', () => {
    for (const score of scores) {
      const state = scoreState(score);
      expect(['gain', 'no-gain'].includes(state)).toBe(passedGate(score));
    }
  });
});

describe('a score whose statistics are written in snake case', () => {
  // The gate report writes snake_case, and a catalogue file or an
  // eval-score.json carries it through untouched.
  const entityWith = (raw: unknown) =>
    ({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'System',
      metadata: {
        name: 'x',
        annotations: { 'wololo.dev/eval-score': JSON.stringify(raw) },
      },
    } as any);

  it('reads a significant regression, so a measurably worse asset is not installable', () => {
    const score = readEvalScore(
      entityWith({
        verdict: 'PASS',
        stats: { significant_regression: true, significant_improvement: false },
      }),
    );
    expect(scoreState(score)).toBe('regressed');
    expect(passedGate(score)).toBe(false);
  });

  it('reads every statistic in either spelling', () => {
    const snake = readEvalScore(
      entityWith({
        verdict: 'PASS',
        origin: 'gate-report',
        stats: {
          mean_delta: 0.05,
          ci_low: 0.02,
          ci_high: 0.08,
          confidence: 0.95,
          significant_improvement: true,
        },
      }),
    )!;
    const camel = readEvalScore(
      entityWith({
        verdict: 'PASS',
        stats: {
          meanDelta: 0.05,
          ciLow: 0.02,
          ciHigh: 0.08,
          confidence: 0.95,
          significantImprovement: true,
        },
      }),
    )!;
    expect(snake.stats).toEqual(camel.stats);
    expect(scoreState(snake)).toBe('gain');
  });
});

describe('measuredCommit', () => {
  const read = (measuredCommit: unknown) =>
    readEvalScore({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'System',
      metadata: {
        name: 'x',
        annotations: {
          'wololo.dev/eval-score': JSON.stringify({
            verdict: 'PASS',
            measuredCommit,
          }),
        },
      },
    } as any)!;

  it('keeps a real commit lower cased, and anything else as the text it was written as', () => {
    expect(read('ABCDEF1').measuredCommit).toBe('abcdef1');
    expect(read(1234567).measuredCommit).toBe('1234567');
    // A tag or a branch is not a commit, and dropping it would make the score
    // read as current. It is kept so staleness can be shown with the value.
    expect(read('v1.2.0').measuredCommit).toBe('v1.2.0');
    expect(read('main').measuredCommit).toBe('main');
    expect(read({}).measuredCommit).toBeUndefined();
  });

  it('stays stale unless it is a full or prefix match of the pinned commit', () => {
    const pinned = `abcdef1${'0'.repeat(33)}`;
    for (const measured of ['v1.2.0', 'main', 'abc12', 'a', 'fedcba9']) {
      expect(isScoreStale(read(measured), pinned)).toBe(true);
    }
    expect(isScoreStale(read('abcdef1'), pinned)).toBe(false);
    expect(isScoreStale(read(pinned), pinned)).toBe(false);
  });

  it('compares without regard to case', () => {
    expect(isScoreStale(read('ABCDEF1'), `abcdef1${'0'.repeat(33)}`)).toBe(
      false,
    );
    expect(isScoreStale(read('abcdef1'), `ABCDEF1${'0'.repeat(33)}`)).toBe(
      false,
    );
  });

  it('has nothing to compare against when the pinned commit is unknown or not a commit', () => {
    expect(isScoreStale(read('abcdef1'), undefined)).toBe(false);
    expect(isScoreStale(read('abcdef1'), 'a')).toBe(false);
  });
});

describe('describeVerdict', () => {
  it('says the verdict is missing in the same words the badge uses', () => {
    expect(describeVerdict({})).toBe('verdict missing');
    expect(describeVerdict({ verdict: 'pass' })).toBe('PASS');
  });
});

describe('a statistic written in both spellings', () => {
  const readStats = (written: unknown) =>
    readEvalScore({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'System',
      metadata: {
        name: 'x',
        annotations: {
          'wololo.dev/eval-score': JSON.stringify({
            verdict: 'PASS',
            stats: written,
          }),
        },
      },
    } as any)!;

  it('takes the first value that is the right type, not the first one present', () => {
    // A wrong-typed camelCase value must not hide a valid snake_case one, or a
    // measurably worse asset loses its regression.
    const score = readStats({
      significantRegression: 'yes',
      significant_regression: true,
      ciLow: 'low',
      ci_low: 0.1,
    });
    expect(score.stats?.significantRegression).toBe(true);
    expect(score.stats?.ciLow).toBe(0.1);
    expect(scoreState(score)).toBe('regressed');
  });
});

describe('where a score came from', () => {
  it('is kept when it is one of the known origins and dropped otherwise', () => {
    const read = (origin: unknown) =>
      readEvalScore({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'System',
        metadata: {
          name: 'x',
          annotations: {
            'wololo.dev/eval-score': JSON.stringify({
              verdict: 'PASS',
              origin,
            }),
          },
        },
      } as any)!.origin;
    expect(read('gate-report')).toBe('gate-report');
    expect(read('eval-score')).toBe('eval-score');
    expect(read('catalogue')).toBe('catalogue');
    expect(read('made-up')).toBeUndefined();
  });

  it('is labelled in words, with the ones that are not a gate run saying so', () => {
    expect(describeOrigin('gate-report')).toBe('a gate report');
    expect(describeOrigin('eval-score')).toBe(
      'an eval-score.json, not a gate run',
    );
    expect(describeOrigin('catalogue')).toBe(
      'a catalogue file, not a gate run',
    );
    expect(describeOrigin(undefined)).toBe('an unknown source, not a gate run');
  });
});
