import { Box, Button, Typography, makeStyles } from '@material-ui/core';
import { Asset, Facets, facetCounts } from '../model';

const useStyles = makeStyles(theme => ({
  root: {
    position: 'sticky',
    top: theme.spacing(2),
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
    minHeight: 30,
  },
  title: {
    fontWeight: 600,
    fontSize: 13,
  },
  group: {
    marginBottom: theme.spacing(3),
  },
  legend: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: theme.palette.textSubtle,
    marginBottom: theme.spacing(0.75),
    display: 'block',
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1.5),
    width: '100%',
    // 36px keeps the row a comfortable pointer target without turning a dense
    // filter list into a stack of buttons.
    minHeight: 36,
    padding: theme.spacing(0.5, 1),
    margin: `0 ${theme.spacing(-1)}px`,
    border: 'none',
    borderRadius: theme.shape.borderRadius,
    background: 'transparent',
    color: theme.palette.text.primary,
    font: 'inherit',
    fontSize: 14,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 1,
    },
  },
  optionSelected: {
    backgroundColor: theme.palette.action.selected,
    fontWeight: 600,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
  },
  tick: {
    width: 14,
    flex: '0 0 14px',
    color: theme.palette.primary.main,
    fontSize: 13,
    lineHeight: 1,
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  count: {
    color: theme.palette.textSubtle,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 12,
    flex: '0 0 auto',
  },
  empty: {
    color: theme.palette.textSubtle,
    fontSize: 13,
  },
  '@media (prefers-reduced-motion: reduce)': {
    option: { transition: 'none' },
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
 * Facets over the whole catalogue.
 *
 * Counts are computed against the other dimensions rather than the full set,
 * so every number offered is a number you can actually reach. A facet whose
 * count would be zero is not rendered at all: a dead end is worse than a
 * shorter list.
 *
 * The rows are real buttons with `aria-pressed`, not checkboxes, because they
 * toggle a view rather than collect a value, and a screen reader should hear
 * the state rather than a form control that is never submitted.
 */
export const FacetPanel = ({ assets, facets, onChange }: FacetPanelProps) => {
  const classes = useStyles();
  const active = GROUPS.reduce(
    (total, g) => total + (facets[g.key] as string[]).length,
    0,
  );

  const toggle = (dimension: Dimension, value: string) => {
    const current = facets[dimension] as string[];
    onChange({
      ...facets,
      [dimension]: current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value],
    });
  };

  const clear = () =>
    onChange({ ...facets, type: [], score: [], harness: [], owner: [] });

  return (
    <nav className={classes.root} aria-label="Filter assets">
      <div className={classes.header}>
        <Typography className={classes.title}>Filters</Typography>
        {active > 0 && (
          <Button size="small" color="primary" onClick={clear}>
            Clear {active}
          </Button>
        )}
      </div>

      {GROUPS.map(group => {
        const counts = facetCounts(assets, facets, group.key);
        const values = [...counts.entries()].sort((a, b) =>
          b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
        );
        const selected = facets[group.key] as string[];

        return (
          <Box
            key={group.key}
            component="section"
            className={classes.group}
            aria-labelledby={`facet-${group.key}`}
          >
            <Typography id={`facet-${group.key}`} className={classes.legend}>
              {group.title}
            </Typography>

            {values.length === 0 ? (
              <Typography className={classes.empty}>
                nothing left to filter by
              </Typography>
            ) : (
              values.map(([value, count]) => {
                const on = selected.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(group.key, value)}
                    className={`${classes.option} ${
                      on ? classes.optionSelected : ''
                    }`}
                  >
                    <span className={classes.label}>
                      <span className={classes.tick} aria-hidden="true">
                        {on ? '✓' : ''}
                      </span>
                      <span className={classes.name}>{value}</span>
                    </span>
                    <span className={classes.count}>{count}</span>
                  </button>
                );
              })
            )}
          </Box>
        );
      })}
    </nav>
  );
};
