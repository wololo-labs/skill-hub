import { makeStyles } from '@material-ui/core';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    fontWeight: 600,
    fontSize: 17,
    letterSpacing: '-0.015em',
    color: theme.palette.navigation.selectedColor,
    whiteSpace: 'nowrap',
  },
  owner: {
    fontWeight: 400,
    color: theme.palette.navigation.color,
  },
}));

/**
 * A wordmark, not a picture. The hub is a register run by a named team, and
 * saying so in type is more honest than a logotype it has not earned.
 */
export const LogoFull = () => {
  const classes = useStyles();
  return (
    <span className={classes.root}>
      <span className={classes.owner}>wololo</span>
      <span>skill hub</span>
    </span>
  );
};
