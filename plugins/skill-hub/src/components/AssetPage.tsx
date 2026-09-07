import { useParams } from 'react-router-dom';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
  makeStyles,
} from '@material-ui/core';
import {
  Content,
  Header,
  InfoCard,
  Link,
  MarkdownContent,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useRouteRef } from '@backstage/frontend-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import useAsync from 'react-use/esm/useAsync';
import { toAsset } from '../model';
import { skillHubApiRef } from '../api';
import { rootRouteRef } from '../plugin';
import { InstallPanel } from './InstallPanel';
import { ScoreBadge } from './ScoreBadge';

const useStyles = makeStyles(theme => ({
  body: {
    // A skill body is a document. Cap it for reading, and let anything that
    // cannot wrap scroll inside itself rather than widening the page.
    maxWidth: '74ch',
    '& p, & li': { fontSize: 14.5, lineHeight: 1.65 },
    '& pre': {
      overflowX: 'auto',
      fontSize: 12.5,
      padding: theme.spacing(1.5),
      borderRadius: theme.shape.borderRadius,
      border: `1px solid ${theme.palette.divider}`,
      backgroundColor: theme.palette.background.default,
    },
    '& code': { fontSize: '0.92em' },
    '& table': { display: 'block', overflowX: 'auto', maxWidth: '100%' },
    '& img': { maxWidth: '100%' },
    '& h1, & h2, & h3': { letterSpacing: '-0.012em' },
  },
  cell: {
    borderBottom: 'none',
    padding: theme.spacing(0.6, 0),
    verticalAlign: 'top',
    fontSize: 13,
  },
  key: {
    color: theme.palette.textSubtle,
    width: 116,
    paddingRight: theme.spacing(1.5),
  },
  value: {
    overflowWrap: 'anywhere',
  },
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontVariantNumeric: 'tabular-nums',
  },
  stale: {
    marginTop: theme.spacing(1.5),
    padding: theme.spacing(1, 1.25),
    borderRadius: theme.shape.borderRadius,
    border: `1px solid ${theme.palette.status.warning}`,
    color: theme.palette.text.primary,
    fontSize: 12.5,
    lineHeight: 1.55,
  },
  muted: {
    color: theme.palette.textSubtle,
    fontSize: 13.5,
    lineHeight: 1.6,
  },
  badges: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  type: {
    fontWeight: 700,
    fontSize: 10.5,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 3,
    padding: '3px 7px',
    color: theme.palette.text.primary,
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 28,
    padding: theme.spacing(0.25, 0),
    fontSize: 13.5,
  },
  lede: {
    fontSize: 15,
    lineHeight: 1.6,
    maxWidth: '74ch',
    marginBottom: theme.spacing(3),
    color: theme.palette.text.primary,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: theme.spacing(3),
    alignItems: 'start',
    [theme.breakpoints.up('md')]: {
      gridTemplateColumns: 'minmax(0, 1fr) 340px',
    },
  },
  side: {
    display: 'grid',
    gap: theme.spacing(3),
  },
}));

/** The asset itself: what it is, where it came from, what it scored. */
export const AssetPage = () => {
  const classes = useStyles();
  const catalogApi = useApi(catalogApiRef);
  const skillHubApi = useApi(skillHubApiRef);
  const rootRoute = useRouteRef(rootRouteRef);
  const { kind, namespace, name } = useParams();
  const entityRef = `${kind}:${namespace}/${name}`;

  const entity = useAsync(
    () => catalogApi.getEntityByRef(entityRef),
    [catalogApi, entityRef],
  );
  const body = useAsync(
    () => skillHubApi.getAssetBody(entityRef),
    [skillHubApi, entityRef],
  );

  if (entity.loading) {
    return (
      <Page themeId="home">
        <Header title="Loading asset" />
        <Content>
          <Progress />
        </Content>
      </Page>
    );
  }

  if (entity.error) {
    return (
      <Page themeId="home">
        <Header title="Could not load this asset" />
        <Content>
          <ResponseErrorPanel error={entity.error} />
        </Content>
      </Page>
    );
  }

  if (!entity.value) {
    return (
      <Page themeId="home">
        <Header title="No such asset" />
        <Content>
          <Typography className={classes.lede}>
            Nothing in the catalogue is called{' '}
            <span className={classes.mono}>{entityRef}</span>. It may have been
            unpublished: the provider is authoritative for what it emitted, so
            a repository that removes its manifest removes its assets on the
            next sync.
          </Typography>
          <Link to={rootRoute?.() ?? '/'}>Back to the hub</Link>
        </Content>
      </Page>
    );
  }

  const asset = toAsset(entity.value);
  const score = asset.score;
  const stale =
    score?.measuredCommit &&
    asset.commit &&
    !asset.commit.startsWith(score.measuredCommit) &&
    !score.measuredCommit.startsWith(asset.commit);

  return (
    <Page themeId="home">
      <Header
        title={asset.title}
        subtitle={asset.repo ?? 'Registered by hand'}
      >
        <div className={classes.badges}>
          <span className={classes.type}>{asset.type}</span>
          <ScoreBadge score={score} size="medium" />
        </div>
      </Header>

      <Content>
        <Box mb={2}>
          <Link className={classes.back} to={rootRoute?.() ?? '/'}>
            &larr; All assets
          </Link>
        </Box>

        {asset.description && (
          <Typography className={classes.lede}>{asset.description}</Typography>
        )}

        <div className={classes.columns}>
          <InfoCard
            title={body.value?.path?.split('/').pop() ?? 'Asset'}
            subheader={body.value?.path}
            deepLink={
              body.value?.url
                ? { title: 'Read it on GitHub', link: body.value.url }
                : undefined
            }
          >
            {body.loading && <Progress />}
            {body.error && <ResponseErrorPanel error={body.error} />}
            {!body.loading && !body.error && body.value?.content && (
              <div className={classes.body}>
                <MarkdownContent content={body.value.content} dialect="gfm" />
              </div>
            )}
            {!body.loading && !body.error && !body.value?.content && (
              <Typography className={classes.muted}>
                {body.value?.reason ??
                  'This asset has no rendered body. Follow the source link to read it in the repository.'}
              </Typography>
            )}
          </InfoCard>

          <div className={classes.side}>
            <InstallPanel asset={asset} />

            <InfoCard title="Provenance">
              <Table size="small">
                <TableBody>
                  <Row label="Owner" value={asset.owner} />
                  {asset.repo && (
                    <Row
                      label="Repository"
                      value={
                        <Link to={`https://github.com/${asset.repo}`}>
                          {asset.repo}
                        </Link>
                      }
                    />
                  )}
                  {asset.commit && (
                    <Row
                      label="Pinned to"
                      value={
                        <span className={classes.mono}>
                          {asset.commit.slice(0, 12)}
                        </span>
                      }
                    />
                  )}
                  {asset.path && (
                    <Row
                      label="Path"
                      value={<span className={classes.mono}>{asset.path}</span>}
                    />
                  )}
                  {asset.harnesses.length > 0 && (
                    <Row label="Harnesses" value={asset.harnesses.join(', ')} />
                  )}
                  {typeof asset.entity.spec?.system === 'string' && (
                    <Row label="Pack" value={asset.entity.spec.system} />
                  )}
                </TableBody>
              </Table>
            </InfoCard>

            <InfoCard title="Eval score">
              {score ? (
                <>
                  <Table size="small">
                    <TableBody>
                      <Row label="Verdict" value={score.verdict ?? 'recorded'} />
                      {score.recorded && (
                        <Row label="Recorded" value={score.recorded} />
                      )}
                      {score.measuredCommit && (
                        <Row
                          label="Measured at"
                          value={
                            <span className={classes.mono}>
                              {score.measuredCommit.slice(0, 12)}
                            </span>
                          }
                        />
                      )}
                      {Object.entries(score.metrics ?? {}).map(([metric, v]) => (
                        <Row
                          key={metric}
                          label={metric.replace(/_/g, ' ')}
                          value={
                            <span className={classes.mono}>
                              {v.candidate} against {v.baseline} baseline
                            </span>
                          }
                        />
                      ))}
                    </TableBody>
                  </Table>

                  {stale && (
                    <Typography className={classes.stale}>
                      This score was measured at{' '}
                      <span className={classes.mono}>
                        {score.measuredCommit!.slice(0, 12)}
                      </span>
                      , which is not the commit the asset is pinned to. The
                      numbers below describe that earlier tree.
                    </Typography>
                  )}

                  {score.source && (
                    <Box mt={1.5}>
                      <Link to={score.source}>
                        Eval gate report
                        {score.sourceVisibility === 'internal'
                          ? ' (internal, needs repository access)'
                          : ''}
                      </Link>
                    </Box>
                  )}
                </>
              ) : (
                <Typography className={classes.muted}>
                  No eval gate report is attached to this asset. It browses and
                  reads here, but it does not install.
                </Typography>
              )}
            </InfoCard>
          </div>
        </div>
      </Content>
    </Page>
  );
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => {
  const classes = useStyles();
  return (
    <TableRow>
      <TableCell
        component="th"
        scope="row"
        className={`${classes.cell} ${classes.key}`}
      >
        {label}
      </TableCell>
      <TableCell className={`${classes.cell} ${classes.value}`}>
        {value}
      </TableCell>
    </TableRow>
  );
};
