import { Chip, Tooltip, makeStyles } from '@material-ui/core';
import { EvalScore } from '@internal/plugin-skill-hub-common';

const useStyles = makeStyles(theme => ({
  chip: {
    margin: 0,
    fontWeight: 600,
    letterSpacing: 0.2,
  },
  pass: {
    backgroundColor: theme.palette.status.ok,
    color: theme.palette.getContrastText(theme.palette.status.ok),
  },
  fail: {
    backgroundColor: theme.palette.status.error,
    color: theme.palette.getContrastText(theme.palette.status.error),
  },
  unscored: {
    backgroundColor: 'transparent',
    border: `1px dashed ${theme.palette.textSubtle}`,
    color: theme.palette.textSubtle,
  },
}));

export interface ScoreBadgeProps {
  score?: EvalScore;
  size?: 'small' | 'medium';
}

/**
 * The score, or the absence of one, stated the same way everywhere. An
 * unscored asset is not a failure and does not read as one, but it is
 * visibly different from a gate that passed.
 */
export const ScoreBadge = ({ score, size = 'small' }: ScoreBadgeProps) => {
  const classes = useStyles();

  if (!score) {
    return (
      <Tooltip title="No eval gate report is attached to this asset, so it cannot be installed from here">
        <Chip
          size={size}
          label="unscored"
          className={`${classes.chip} ${classes.unscored}`}
        />
      </Tooltip>
    );
  }

  const verdict = (score.verdict ?? 'scored').toUpperCase();
  const passed = verdict === 'PASS';
  const headline = topMetric(score);
  return (
    <Tooltip
      title={
        headline
          ? `${headline.name} ${headline.candidate} against a ${headline.baseline} baseline, recorded ${score.recorded ?? 'at an unknown date'}`
          : `Eval gate ${verdict}`
      }
    >
      <Chip
        size={size}
        label={headline ? `${verdict} · ${headline.candidate}` : verdict}
        className={`${classes.chip} ${passed ? classes.pass : classes.fail}`}
      />
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
