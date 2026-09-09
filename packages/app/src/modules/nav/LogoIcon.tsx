import { makeStyles } from '@material-ui/core';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 32,
    minWidth: 32,
    fontWeight: 600,
    fontSize: 17,
    letterSpacing: '-0.02em',
    color: theme.palette.navigation.selectedColor,
  },
}));

/** The collapsed sidebar keeps the initials and drops the rest. */
export const LogoIcon = () => {
  const classes = useStyles();
  return <span className={classes.root}>sh</span>;
};
