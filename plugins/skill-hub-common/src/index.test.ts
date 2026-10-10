import { EvalScore, isScoreStale, scoreState } from './index';

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
