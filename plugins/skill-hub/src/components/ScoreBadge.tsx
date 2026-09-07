import { Tooltip, makeStyles } from '@material-ui/core';
import { EvalScore } from '@internal/plugin-skill-hub-common';

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
}

/**
 * The score, or the absence of one, stated the same way everywhere.
 *
 * An unscored asset is not a failure and must not read as one, but it has to
 * be unmistakably different from a gate that passed, because that difference
 * is what decides whether the install button works.
 */
export const ScoreBadge = ({ score, size = 'small' }: ScoreBadgeProps) => {
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

  const verdict = (score.verdict ?? 'scored').toUpperCase();
  const passed = verdict === 'PASS';
  const headline = topMetric(score);

  // The number on the badge means nothing on its own, so what it measures
  // travels with it: in the tooltip for a pointer, and in the accessible name
  // for everyone a tooltip never reaches.
  const explanation = headline
    ? `Eval gate ${verdict}: ${headline.name} ${headline.candidate} against a ${headline.baseline} baseline, recorded ${score.recorded ?? 'on an unknown date'}`
    : `Eval gate ${verdict}`;

  return (
    <Tooltip title={explanation}>
      <span className={`${sized} ${passed ? classes.pass : classes.fail}`}>
        <span className={classes.visible} aria-hidden="true">
          {verdict}
          {headline && (
            <span className={classes.metric}>{headline.candidate}</span>
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
};

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
