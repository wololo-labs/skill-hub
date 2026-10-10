import { Tooltip, makeStyles } from '@material-ui/core';
import {
  EvalScore,
  isScoreStale,
  scoreState,
} from '@internal/plugin-skill-hub-common';

const useStyles = makeStyles(theme => ({
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 22,
    padding: '0 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    border: '1px solid transparent',
  },
  visible: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
  medium: {
    height: 26,
    fontSize: 12,
    padding: '0 10px',
  },
  // The verdict is the only place on this surface that earns a filled colour.
  pass: {
    backgroundColor: theme.palette.highlight,
    // The darker end of the ok ramp, not status.ok itself: status.ok on the
    // highlight surface measures 4.43:1, which misses AA at this size.
    color: theme.palette.infoText,
    borderColor: theme.palette.status.ok,
  },
  fail: {
    backgroundColor: 'transparent',
    color: theme.palette.status.error,
    borderColor: theme.palette.status.error,
  },
  // Unscored is deliberately achromatic and dashed. State is never carried by
  // colour alone here: the shape of the border differs too, and the word says
  // it outright.
  unscored: {
    backgroundColor: 'transparent',
    color: theme.palette.textSubtle,
    borderColor: theme.palette.textSubtle,
    borderStyle: 'dashed',
    fontWeight: 600,
  },
  // Passed, but nothing shows it beats the model alone. Amber and dashed: not
  // the green of a demonstrated gain, not the red of a failure, and not the
  // grey of unscored.
  nogain: {
    backgroundColor: theme.palette.warningBackground,
    color: theme.palette.warningText,
    borderColor: theme.palette.status.warning,
    borderStyle: 'dashed',
  },
  pair: {
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    maxWidth: 360,
  },
  commits: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.palette.status.warning,
  },
  metric: {
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: 0,
    fontWeight: 600,
    opacity: 0.9,
  },
}));

export interface ScoreBadgeProps {
  score?: EvalScore;
  size?: 'small' | 'medium';
  /** The commit the asset is pinned to, so a stale score can be shown as one. */
  pinnedCommit?: string;
}

/**
 * The score, or the absence of one, stated the same way everywhere.
 *
 * An unscored asset is not a failure and must not read as one, but it has to
 * be unmistakably different from a gate that passed, because that difference
 * is what decides whether the install button works.
 */
export const ScoreBadge = ({
  score,
  size = 'small',
  pinnedCommit,
}: ScoreBadgeProps) => {
  const classes = useStyles();
  const sized = `${classes.badge} ${size === 'medium' ? classes.medium : ''}`;

  if (!score) {
    const why =
      'Unscored: no eval gate report is attached to this asset, so it cannot be installed from here';
    return (
      <Tooltip title={why}>
        <span className={`${sized} ${classes.unscored}`}>
          <span aria-hidden="true">unscored</span>
          <span className={classes.srOnly}>{why}</span>
        </span>
      </Tooltip>
    );
  }

  const state = scoreState(score);
  const verdict = (score.verdict ?? 'scored').toUpperCase();
  const label = {
    gain: 'measured gain',
    'no-gain': 'no measured gain over the model alone',
    regressed: 'regressed',
    failed: verdict,
    unscored: 'unscored',
  }[state];
  const style = {
    gain: classes.pass,
    'no-gain': classes.nogain,
    regressed: classes.fail,
    failed: classes.fail,
    unscored: classes.unscored,
  }[state];
  const headline = topMetric(score);
  const ci = score.stats;
  const interval =
    ci?.ciLow !== undefined && ci.ciHigh !== undefined
      ? ` Mean change ${ci.meanDelta?.toFixed(4) ?? 'unrecorded'}, ${Math.round(
          (ci.confidence ?? 0.95) * 100,
        )}% interval ${ci.ciLow.toFixed(4)} to ${ci.ciHigh.toFixed(4)}.`
      : '';

  // The number on the badge means nothing on its own, so what it measures
  // travels with it: in the tooltip for a pointer, and in the accessible name
  // for everyone a tooltip never reaches.
  const measured = headline
    ? ` ${headline.name} ${headline.candidate} against a ${headline.baseline} baseline, recorded ${score.recorded ?? 'on an unknown date'}.`
    : '';
  const explanation = `Eval gate ${verdict}: ${label}.${interval}${measured}`;

  // The score is never hidden for being old, only dated: both commits sit
  // beside the badge so the reader can see exactly how far apart they are.
  const stale = isScoreStale(score, pinnedCommit);
  const staleNote = stale
    ? `scored at ${score.measuredCommit!.slice(
        0,
        7,
      )}, pinned ${pinnedCommit!.slice(0, 7)}`
    : undefined;

  const badge = (
    <Tooltip title={explanation}>
      <span className={`${sized} ${style}`}>
        <span className={classes.visible} aria-hidden="true">
          {label}
          {state === 'gain' && headline && (
            <span className={classes.metric}>
              {fmt(headline.candidate)}
            </span>
          )}
        </span>
        {/*
          The number on the badge means nothing on its own, and a tooltip
          reaches neither a screen reader nor a touch device. What it measures
          travels in the accessible name instead of behind a hover.
        */}
        <span className={classes.srOnly}>{explanation}</span>
      </span>
    </Tooltip>
  );
  if (!staleNote) return badge;
  return (
    <span className={classes.pair}>
      {badge}
      <span className={classes.commits}>stale: {staleNote}</span>
    </span>
  );
};

/** A number as three places, or the text a hand-written score gave. */
const fmt = (value: number | string) =>
  typeof value === 'number' ? value.toFixed(3) : value;

/** The first metric, which is the one the gate is named after. */
function topMetric(score: EvalScore) {
  const entries = Object.entries(score.metrics ?? {});
  if (!entries.length) return undefined;
  const [name, metric] = entries[0];
  return {
    name: name.replace(/_/g, ' '),
    candidate: metric.candidate,
    baseline: metric.baseline,
  };
}
