import { useParams } from 'react-router-dom';
import {
  Box,
  Chip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
  makeStyles,
} from '@material-ui/core';
import {
  Content,
  ContentHeader,
  Header,
  InfoCard,
  Link,
  MarkdownContent,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import useAsync from 'react-use/esm/useAsync';
import { toAsset } from '../model';
import { skillHubApiRef } from '../api';
import { InstallPanel } from './InstallPanel';
import { ScoreBadge } from './ScoreBadge';

const useStyles = makeStyles(theme => ({
  body: {
    '& pre': {
      overflowX: 'auto',
    },
  },
  cell: {
    borderBottom: 'none',
    padding: theme.spacing(0.75, 0),
    verticalAlign: 'top',
  },
  key: {
    color: theme.palette.textSubtle,
    width: 132,
    fontSize: 13,
  },
  value: {
    fontSize: 13,
    wordBreak: 'break-word',
  },
  mono: {
    fontFamily: 'monospace',
  },
  stale: {
    marginTop: theme.spacing(1),
    color: theme.palette.status.warning,
    fontSize: 12,
  },
  missing: {
    color: theme.palette.textSubtle,
  },
}));

/** The asset itself: what it is, where it came from, what it scored. */
export const AssetPage = () => {
  const classes = useStyles();
  const catalogApi = useApi(catalogApiRef);
  const skillHubApi = useApi(skillHubApiRef);
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
        <Content>
          <Progress />
        </Content>
      </Page>
    );
  }
  if (entity.error) {
    return (
      <Page themeId="home">
        <Content>
          <ResponseErrorPanel error={entity.error} />
        </Content>
      </Page>
    );
  }
  if (!entity.value) {
    return (
      <Page themeId="home">
        <Header title="Not found" />
        <Content>
          <Typography>
            No asset named <code>{entityRef}</code> is in the catalogue. It may
            have been unpublished: the provider is authoritative, so removing a
            manifest removes its assets on the next sync.
          </Typography>
        </Content>
      </Page>
    );
  }

  const asset = toAsset(entity.value);
  const score = asset.score;
  const stale =
    score?.measuredCommit &&
    asset.commit &&
    !asset.commit.startsWith(score.measuredCommit);

  return (
    <Page themeId="home">
      <Header title={asset.title} subtitle={asset.repo}>
        <Box display="flex" alignItems="center" gridGap={8}>
          <Chip size="small" label={asset.type} />
          <ScoreBadge score={score} size="medium" />
        </Box>
      </Header>
      <Content>
        <ContentHeader title={asset.description || ' '}>
          <Link to="..">Back to the hub</Link>
        </ContentHeader>
        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <InfoCard title="Asset">
              {body.loading && <Progress />}
              {body.error && <ResponseErrorPanel error={body.error} />}
              {body.value?.content ? (
                <div className={classes.body}>
                  <MarkdownContent
                    content={body.value.content}
                    dialect="gfm"
                  />
                </div>
              ) : (
                !body.loading && (
                  <Typography variant="body2" className={classes.missing}>
                    {body.value?.reason ??
                      'This asset has no rendered body. Follow the source link to read it in the repository.'}
                  </Typography>
                )
              )}
            </InfoCard>
          </Grid>

          <Grid item xs={12} md={4}>
            <Box mb={3}>
              <InstallPanel asset={asset} />
            </Box>

            <Box mb={3}>
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
                      <Row
                        label="Harnesses"
                        value={asset.harnesses.join(', ')}
                      />
                    )}
                    {asset.entity.spec?.system ? (
                      <Row
                        label="Pack"
                        value={String(asset.entity.spec.system)}
                      />
                    ) : null}
                  </TableBody>
                </Table>
              </InfoCard>
            </Box>

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
                      {Object.entries(score.metrics ?? {}).map(
                        ([metric, values]) => (
                          <Row
                            key={metric}
                            label={metric.replace(/_/g, ' ')}
                            value={`${values.candidate} against ${values.baseline} baseline`}
                          />
                        ),
                      )}
                    </TableBody>
                  </Table>
                  {stale && (
                    <Typography className={classes.stale}>
                      This score was measured at{' '}
                      {score.measuredCommit!.slice(0, 12)}, not at the commit
                      the asset is pinned to.
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
                <Typography variant="body2" className={classes.missing}>
                  No eval gate report is attached to this asset, so it browses
                  and reads here but does not install.
                </Typography>
              )}
            </InfoCard>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => {
  const classes = useStyles();
  return (
    <TableRow>
      <TableCell className={`${classes.cell} ${classes.key}`}>{label}</TableCell>
      <TableCell className={`${classes.cell} ${classes.value}`}>
        {value}
      </TableCell>
    </TableRow>
  );
};
