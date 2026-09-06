import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Chip,
  Grid,
  InputAdornment,
  TextField,
  Typography,
  makeStyles,
} from '@material-ui/core';
import SearchIcon from '@material-ui/icons/Search';
import {
  Content,
  EmptyState,
  Header,
  HeaderLabel,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import {
  CATALOG_FILTER_EXISTS,
  catalogApiRef,
} from '@backstage/plugin-catalog-react';
import useAsync from 'react-use/esm/useAsync';
import { ANNOTATION_HARNESSES } from '@internal/plugin-skill-hub-common';
import {
  Asset,
  EMPTY_FACETS,
  Facets,
  applyFacets,
  assetPath,
  toAsset,
} from '../model';
import { FacetPanel } from './FacetPanel';
import { ScoreBadge } from './ScoreBadge';

const useStyles = makeStyles(theme => ({
  search: {
    marginBottom: theme.spacing(2),
  },
  row: {
    display: 'block',
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    border: `1px solid ${theme.palette.divider}`,
    marginBottom: theme.spacing(1.5),
    textDecoration: 'none',
    color: 'inherit',
    transition: 'border-color 120ms ease, transform 120ms ease',
    '&:hover': {
      borderColor: theme.palette.primary.main,
      transform: 'translateY(-1px)',
    },
  },
  name: {
    fontWeight: 600,
    fontSize: 16,
  },
  description: {
    marginTop: theme.spacing(0.5),
    color: theme.palette.textSubtle,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  meta: {
    marginTop: theme.spacing(1),
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    alignItems: 'center',
    fontSize: 12,
    color: theme.palette.textSubtle,
  },
  typeChip: {
    height: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  count: {
    color: theme.palette.textSubtle,
    marginBottom: theme.spacing(1.5),
  },
}));

/**
 * Everything the estate publishes, in one list.
 *
 * The query is the annotation vocabulary itself: an entity is an agent asset
 * exactly when the provider stamped it as one, which keeps this page honest
 * when someone registers an unrelated entity in the same catalogue.
 */
export const BrowsePage = () => {
  const classes = useStyles();
  const catalogApi = useApi(catalogApiRef);
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);

  const { value, loading, error } = useAsync(async () => {
    const response = await catalogApi.getEntities({
      filter: {
        [`metadata.annotations.${ANNOTATION_HARNESSES}`]: CATALOG_FILTER_EXISTS,
      },
      limit: 10000,
    });
    return response.items.map(toAsset);
  }, [catalogApi]);

  const assets = useMemo<Asset[]>(() => value ?? [], [value]);
  const visible = useMemo(
    () => applyFacets(assets, facets),
    [assets, facets],
  );

  return (
    <Page themeId="home">
      <Header
        title="skill hub"
        subtitle="Every agent asset the estate publishes: skills, agents, hooks, prompts, eval suites, MCP servers and packs"
      >
        <HeaderLabel label="Assets" value={assets.length} />
        <HeaderLabel
          label="Scored"
          value={assets.filter(a => a.score).length}
        />
      </Header>
      <Content>
        {loading && <Progress />}
        {error && <ResponseErrorPanel error={error} />}
        {!loading && !error && (
          <Grid container spacing={4}>
            <Grid item xs={12} md={3}>
              <FacetPanel
                assets={assets}
                facets={facets}
                onChange={setFacets}
              />
            </Grid>
            <Grid item xs={12} md={9}>
              <TextField
                className={classes.search}
                fullWidth
                variant="outlined"
                size="small"
                placeholder="Search by name, description, repository or tag"
                value={facets.text}
                onChange={e =>
                  setFacets({ ...facets, text: e.target.value })
                }
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <Typography variant="body2" className={classes.count}>
                {visible.length} of {assets.length} assets
              </Typography>

              {visible.length === 0 ? (
                <EmptyState
                  missing="data"
                  title="Nothing matches those filters"
                  description="Clear a facet, or add .agent-assets.yaml to a repository so it joins the catalogue on the next sync."
                />
              ) : (
                visible.map(asset => (
                  <RouterLink
                    key={asset.entityRef}
                    to={assetPath(asset)}
                    className={classes.row}
                  >
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      gridGap={12}
                    >
                      <Typography className={classes.name}>
                        {asset.title}
                      </Typography>
                      <ScoreBadge score={asset.score} />
                    </Box>
                    <Typography variant="body2" className={classes.description}>
                      {asset.description || 'No description published.'}
                    </Typography>
                    <div className={classes.meta}>
                      <Chip
                        size="small"
                        label={asset.type}
                        className={classes.typeChip}
                      />
                      <span>{asset.owner}</span>
                      {asset.repo && <span>· {asset.repo}</span>}
                      {asset.harnesses.length > 0 && (
                        <span>· {asset.harnesses.join(', ')}</span>
                      )}
                    </div>
                  </RouterLink>
                ))
              )}
            </Grid>
          </Grid>
        )}
      </Content>
    </Page>
  );
};
