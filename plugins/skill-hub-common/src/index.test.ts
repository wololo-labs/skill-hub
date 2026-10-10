import {
  EvalScore,
  describeChange,
  describeVerdict,
  isScoreStale,
  passedGate,
  readEvalScore,
  scoreState,
} from './index';

const stats = (significantImprovement: boolean) => ({
  meanDelta: 0.0003,
  ciLow: -0.01,
  ciHigh: 0.01,
  confidence: 0.95,
  significantImprovement,
});

describe('scoreState', () => {
  it('is a gain only for a pass with a significant improvement', () => {
    expect(scoreState({ verdict: 'PASS', stats: stats(true) })).toBe('gain');
  });

  it('reads a pass that is measurably worse as regressed, and not installable', () => {
    const score = {
      verdict: 'PASS',
      stats: { ...stats(false), significantRegression: true },
    };
    expect(scoreState(score)).toBe('regressed');
    expect(passedGate(score)).toBe(false);
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
    }) as any;

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
    const score = readEvalScore(entityWith({ verdict: 'PASS', measuredCommit: 1234567 }));
    expect(() => isScoreStale(score, 'abc1234')).not.toThrow();
  });
});

describe('describeChange', () => {
  it('states the change, signed, with its interval', () => {
    expect(
      describeChange({ meanDelta: 0.052, ciLow: 0.021, ciHigh: 0.084 }),
    ).toBe('+0.0520 (0.0210 to 0.0840)');
    expect(
      describeChange({ meanDelta: -0.061, ciLow: -0.09, ciHigh: -0.03 }),
    ).toBe('-0.0610 (-0.0900 to -0.0300)');
  });

  it('does not round a small significant gain down to zero', () => {
    expect(
      describeChange({ meanDelta: 0.0004, ciLow: 0.0002, ciHigh: 0.0006 }),
    ).toBe('+0.0004 (0.0002 to 0.0006)');
  });

  it('says unrecorded when the mean is missing, never a blank', () => {
    expect(describeChange({ ciLow: 0.021, ciHigh: 0.084 })).toBe(
      'unrecorded (0.0210 to 0.0840)',
    );
  });

  it('gives the mean alone when there is no interval, and nothing when there is neither', () => {
    expect(describeChange({ meanDelta: 0.1 })).toBe('+0.1000');
    expect(describeChange({})).toBeUndefined();
    expect(describeChange(undefined)).toBeUndefined();
  });
});

describe('one definition of a passed gate', () => {
  const scores: Array<EvalScore | undefined> = [
    undefined,
    {},
    { verdict: 'pass' },
    { verdict: 'PASS', stats: { significantImprovement: true } },
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
    }) as any;

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
          'wololo.dev/eval-score': JSON.stringify({ verdict: 'PASS', measuredCommit }),
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
    expect(isScoreStale(read('ABCDEF1'), `abcdef1${'0'.repeat(33)}`)).toBe(false);
    expect(isScoreStale(read('abcdef1'), `ABCDEF1${'0'.repeat(33)}`)).toBe(false);
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
