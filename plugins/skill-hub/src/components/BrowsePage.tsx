import { useMemo, useState } from 'react';
import {
  Box,
  Grid,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
  makeStyles,
} from '@material-ui/core';
import SearchIcon from '@material-ui/icons/Search';
import ClearIcon from '@material-ui/icons/Close';
import {
  Content,
  Header,
  HeaderLabel,
  Page,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useRouteRef } from '@backstage/frontend-plugin-api';
import {
  CATALOG_FILTER_EXISTS,
  catalogApiRef,
} from '@backstage/plugin-catalog-react';
import { parseEntityRef } from '@backstage/catalog-model';
import useAsync from 'react-use/esm/useAsync';
import { ANNOTATION_HARNESSES } from '@internal/plugin-skill-hub-common';
import { Asset, EMPTY_FACETS, Facets, applyFacets, toAsset } from '../model';
import { assetRouteRef } from '../plugin';
import { AssetRow } from './AssetRow';
import { FacetPanel } from './FacetPanel';
import { RowSkeleton } from './RowSkeleton';

const useStyles = makeStyles(theme => ({
  search: {
    marginBottom: theme.spacing(1.5),
  },
  count: {
    color: theme.palette.textSubtle,
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    marginBottom: theme.spacing(1),
  },
  empty: {
    padding: theme.spacing(6, 2),
    textAlign: 'center',
    border: `1px dashed ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
  emptyTitle: {
    fontWeight: 600,
    marginBottom: theme.spacing(0.5),
  },
  emptyBody: {
    color: theme.palette.textSubtle,
    fontSize: 13.5,
    maxWidth: '52ch',
    margin: '0 auto',
    lineHeight: 1.6,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: '0.95em',
  },
}));

/**
 * Everything the estate publishes, in one list.
 *
 * The query is the annotation vocabulary itself: an entity is an agent asset
 * exactly when the provider stamped it as one. That keeps the page honest in a
 * catalogue that also holds services, and it means the hub never has to
 * enumerate the kinds it knows about.
 *
 * Filtering happens in the browser over the full result set. At this scale
 * that is what makes the facet counts exact and the interaction instant; the
 * ceiling is a few thousand assets, past which this moves to catalogue facets.
 */
export const BrowsePage = () => {
  const classes = useStyles();
  const catalogApi = useApi(catalogApiRef);
  // useRouteRef returns undefined if the asset page has been disabled in
  // config. Losing the link is acceptable, crashing the whole list is not.
  const assetRoute = useRouteRef(assetRouteRef);
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
  const visible = useMemo(() => applyFacets(assets, facets), [assets, facets]);
  const filtered =
    facets.text.trim() !== '' ||
    facets.type.length + facets.score.length + facets.harness.length + facets.owner.length >
      0;

  return (
    <Page themeId="home">
      <Header
        title="skill hub"
        subtitle="Every agent asset the estate publishes, with where it came from and what it scored"
      >
        <HeaderLabel label="Assets" value={loading ? '—' : assets.length} />
        <HeaderLabel
          label="Scored"
          value={loading ? '—' : assets.filter(a => a.score).length}
        />
      </Header>

      <Content>
        {error && <ResponseErrorPanel error={error} />}
        {!error && (
          <Grid container spacing={4}>
            <Grid item xs={12} md={3}>
              <FacetPanel assets={assets} facets={facets} onChange={setFacets} />
            </Grid>

            <Grid item xs={12} md={9}>
              <TextField
                className={classes.search}
                fullWidth
                variant="outlined"
                size="small"
                type="search"
                label="Search assets"
                placeholder="Name, description, repository or tag"
                value={facets.text}
                onChange={e => setFacets({ ...facets, text: e.target.value })}
                InputLabelProps={{ shrink: true }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: facets.text ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        aria-label="Clear the search"
                        onClick={() => setFacets({ ...facets, text: '' })}
                      >
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
              />

              <Typography className={classes.count} role="status">
                {loading
                  ? 'Loading assets'
                  : `${visible.length} of ${assets.length} assets`}
              </Typography>

              {loading && <RowSkeleton rows={6} />}

              {!loading && visible.length === 0 && (
                <Box className={classes.empty}>
                  <Typography className={classes.emptyTitle}>
                    {filtered
                      ? 'Nothing matches those filters'
                      : 'Nothing has been published yet'}
                  </Typography>
                  <Typography className={classes.emptyBody}>
                    {filtered ? (
                      'Clear a filter to widen the search. Every asset in the catalogue came from a repository that opted in, so a gap here usually means a repository has not published yet.'
                    ) : (
                      <>
                        A repository joins the catalogue by committing{' '}
                        <span className={classes.code}>.agent-assets.yaml</span>{' '}
                        to its root. The next sync picks it up, with no change
                        to this application.
                      </>
                    )}
                  </Typography>
                </Box>
              )}

              {!loading &&
                visible.map(asset => {
                  const ref = parseEntityRef(asset.entityRef);
                  return (
                    <AssetRow
                      key={asset.entityRef}
                      asset={asset}
                      to={
                        assetRoute?.({
                          kind: ref.kind.toLowerCase(),
                          namespace: ref.namespace,
                          name: ref.name,
                        }) ?? ''
                      }
                    />
                  );
                })}
            </Grid>
          </Grid>
        )}
      </Content>
    </Page>
  );
};
