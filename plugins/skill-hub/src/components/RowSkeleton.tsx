import { makeStyles } from '@material-ui/core';

const useStyles = makeStyles(theme => ({
  row: {
    padding: theme.spacing(2, 2.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:first-child': { borderTop: `1px solid ${theme.palette.divider}` },
  },
  bar: {
    height: 12,
    borderRadius: 3,
    backgroundColor: theme.palette.action.hover,
    animation: '$pulse 1.4s ease-in-out infinite',
  },
  title: { width: '28%', height: 15, marginBottom: 10 },
  line: { width: '72%', marginBottom: 8 },
  meta: { width: '38%', height: 10 },
  '@keyframes pulse': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.45 },
  },
  '@media (prefers-reduced-motion: reduce)': {
    bar: { animation: 'none' },
  },
}));

/**
 * The list's own shape while it loads, rather than a spinner in the middle of
 * the page. The row count matches what usually lands above the fold, so the
 * layout does not jump when the real rows arrive.
 */
export const RowSkeleton = ({ rows = 6 }: { rows?: number }) => {
  const classes = useStyles();
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={classes.row}>
          <div className={`${classes.bar} ${classes.title}`} />
          <div className={`${classes.bar} ${classes.line}`} />
          <div className={`${classes.bar} ${classes.meta}`} />
        </div>
      ))}
    </div>
  );
};
