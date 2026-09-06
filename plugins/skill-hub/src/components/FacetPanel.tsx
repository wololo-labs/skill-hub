import {
  Box,
  Checkbox,
  FormControlLabel,
  Typography,
  makeStyles,
} from '@material-ui/core';
import { Asset, Facets, facetCounts } from '../model';

const useStyles = makeStyles(theme => ({
  group: {
    marginBottom: theme.spacing(3),
  },
  heading: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 11,
    fontWeight: 700,
    color: theme.palette.textSubtle,
    marginBottom: theme.spacing(0.5),
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 0,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    fontSize: 14,
  },
  count: {
    color: theme.palette.textSubtle,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 12,
  },
  checkbox: {
    padding: theme.spacing(0.5),
  },
  empty: {
    color: theme.palette.textSubtle,
    fontSize: 13,
  },
}));

type Dimension = keyof Omit<Facets, 'text'>;

const GROUPS: Array<{ key: Dimension; title: string }> = [
  { key: 'type', title: 'Type' },
  { key: 'score', title: 'Score' },
  { key: 'harness', title: 'Harness' },
  { key: 'owner', title: 'Owner' },
];

export interface FacetPanelProps {
  assets: Asset[];
  facets: Facets;
  onChange: (facets: Facets) => void;
}

/**
 * Facets over the whole catalogue. Counts are computed against the other
 * dimensions, so every number offered is a number you can actually get.
 */
export const FacetPanel = ({ assets, facets, onChange }: FacetPanelProps) => {
  const classes = useStyles();

  const toggle = (dimension: Dimension, value: string) => {
    const current = facets[dimension] as string[];
    const next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    onChange({ ...facets, [dimension]: next });
  };

  return (
    <Box>
      {GROUPS.map(group => {
        const counts = facetCounts(assets, facets, group.key);
        const values = [...counts.entries()].sort((a, b) =>
          b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
        );
        return (
          <div key={group.key} className={classes.group}>
            <Typography className={classes.heading}>{group.title}</Typography>
            {values.length === 0 && (
              <Typography className={classes.empty}>nothing to filter</Typography>
            )}
            {values.map(([value, count]) => (
              <FormControlLabel
                key={value}
                className={classes.row}
                control={
                  <Checkbox
                    size="small"
                    className={classes.checkbox}
                    color="primary"
                    checked={(facets[group.key] as string[]).includes(value)}
                    onChange={() => toggle(group.key, value)}
                  />
                }
                label={
                  <span className={classes.label}>
                    <span>{value}</span>
                    <span className={classes.count}>{count}</span>
                  </span>
                }
              />
            ))}
          </div>
        );
      })}
    </Box>
  );
};
