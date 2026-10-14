import { memo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Typography, makeStyles } from '@material-ui/core';
import { Asset } from '../model';
import { ScoreBadge } from './ScoreBadge';

const useStyles = makeStyles(theme => ({
  row: {
    display: 'block',
    padding: theme.spacing(2, 2.5),
    borderBottom: `1px solid ${theme.palette.textVerySubtle}`,
    textDecoration: 'none',
    color: 'inherit',
    transition: 'background-color 140ms cubic-bezier(0.16, 1, 0.3, 1)',
    '&:hover': { backgroundColor: theme.palette.action.hover },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: -2,
      backgroundColor: theme.palette.action.hover,
    },
    '&:first-child': {
      borderTop: `1px solid ${theme.palette.textVerySubtle}`,
    },
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    [theme.breakpoints.down('sm')]: {
      // The badge drops to the meta row so the title gets the full width.
      display: 'block',
    },
  },
  badgeWide: {
    [theme.breakpoints.down('sm')]: { display: 'none' },
  },
  badgeNarrow: {
    display: 'none',
    [theme.breakpoints.down('sm')]: { display: 'inline-flex' },
  },
  name: {
    fontWeight: 600,
    fontSize: 15,
    letterSpacing: '-0.01em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    // On a phone the name is the only field that answers "is this the thing",
    // and it is the one that was being cut. Two lines there, one here.
    [theme.breakpoints.down('sm')]: {
      whiteSpace: 'normal',
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
    },
  },
  description: {
    marginTop: 2,
    color: theme.palette.textSubtle,
    fontSize: 13.5,
    lineHeight: 1.5,
    // Two lines is enough to judge relevance; the rest is what the detail
    // page is for.
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    maxWidth: '72ch',
  },
  meta: {
    marginTop: theme.spacing(1),
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontSize: 12,
    color: theme.palette.textSubtle,
    fontVariantNumeric: 'tabular-nums',
  },
  type: {
    fontWeight: 700,
    fontSize: 10.5,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: theme.palette.text.primary,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 3,
    padding: '2px 6px',
  },
  dot: {
    opacity: 0.5,
  },
  '@media (prefers-reduced-motion: reduce)': {
    row: { transition: 'none' },
  },
}));

export interface AssetRowProps {
  asset: Asset;
  to: string;
}

/**
 * One asset in the list.
 *
 * A row rather than a card: the list is long and homogeneous, and a grid of
 * identical cards would spend a lot of space saying nothing the rows do not.
 */
const Row = ({ asset, to }: AssetRowProps) => {
  const classes = useStyles();

  return (
    <RouterLink to={to} className={classes.row}>
      <div className={classes.head}>
        <Typography component="h2" className={classes.name}>
          {asset.title}
        </Typography>
        <span className={classes.badgeWide}>
          <ScoreBadge
            score={asset.score}
            pinnedCommit={asset.commit}
            unscoredReason={asset.unscoredReason}
          />
        </span>
      </div>

      <Typography className={classes.description}>
        {asset.description || 'No description published.'}
      </Typography>

      <div className={classes.meta}>
        <span className={classes.badgeNarrow}>
          <ScoreBadge
            score={asset.score}
            pinnedCommit={asset.commit}
            unscoredReason={asset.unscoredReason}
          />
        </span>
        <span className={classes.type}>{asset.type}</span>
        <span>{asset.owner}</span>
        {asset.repo && (
          <>
            <span className={classes.dot} aria-hidden="true">
              ·
            </span>
            <span>{asset.repo}</span>
          </>
        )}
        {asset.commit && (
          <>
            <span className={classes.dot} aria-hidden="true">
              ·
            </span>
            <span>{asset.commit.slice(0, 7)}</span>
          </>
        )}
      </div>
    </RouterLink>
  );
};

/**
 * Memoised because every keystroke in the search box re-renders the whole
 * list, and a row only changes when its own asset or link does.
 */
export const AssetRow = memo(
  Row,
  (a, b) => a.to === b.to && a.asset.entityRef === b.asset.entityRef,
);
