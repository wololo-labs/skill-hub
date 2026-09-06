import { useState } from 'react';
import {
  Box,
  Chip,
  Tab,
  Tabs,
  Typography,
  makeStyles,
} from '@material-ui/core';
import { CopyTextButton, InfoCard, Link } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { HARNESSES } from '@internal/plugin-skill-hub-common';
import { Asset } from '../model';
import { skillHubApiRef } from '../api';

const useStyles = makeStyles(theme => ({
  command: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5, 2),
    borderRadius: theme.shape.borderRadius,
    background: theme.palette.background.default,
    border: `1px solid ${theme.palette.divider}`,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  commandText: {
    flex: 1,
    margin: 0,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    whiteSpace: 'inherit',
    wordBreak: 'inherit',
  },
  blocked: {
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    border: `1px dashed ${theme.palette.divider}`,
    background: theme.palette.background.default,
  },
  pin: {
    marginTop: theme.spacing(1.5),
    display: 'block',
    color: theme.palette.textSubtle,
  },
  copied: {
    marginLeft: theme.spacing(1),
  },
}));

export interface InstallPanelProps {
  asset: Asset;
}

/**
 * The install gesture: pick a harness, copy one line, run it locally.
 *
 * The button is disabled for an unscored asset on purpose. The score is the
 * gate, so the panel says why and points at how to get one rather than
 * quietly offering a command anyway.
 */
export const InstallPanel = ({ asset }: InstallPanelProps) => {
  const classes = useStyles();
  const api = useApi(skillHubApiRef);
  const offered = HARNESSES.filter(
    h => asset.install[h.id] && asset.harnesses.includes(h.id),
  );
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState<string | undefined>();

  if (!offered.length) {
    return (
      <InfoCard title="Install">
        <Typography variant="body2" color="textSecondary">
          This asset does not publish an install command.
        </Typography>
      </InfoCard>
    );
  }

  const harness = offered[Math.min(selected, offered.length - 1)];
  const command = asset.install[harness.id]!;
  const installable = Boolean(asset.score);

  const onCopy = () => {
    setCopied(harness.id);
    void api.recordCopy(asset.entityRef, harness.id);
  };

  return (
    <InfoCard
      title="Install"
      subheader={
        installable
          ? 'Pinned to the commit below. Run it where you want the asset.'
          : undefined
      }
    >
      <Tabs
        value={Math.min(selected, offered.length - 1)}
        onChange={(_, value) => {
          setSelected(value);
          setCopied(undefined);
        }}
        indicatorColor="primary"
        textColor="primary"
        variant="fullWidth"
      >
        {offered.map(h => (
          <Tab key={h.id} label={h.label} />
        ))}
      </Tabs>

      <Box mt={2}>
        {installable ? (
          <>
            <div className={classes.command}>
              <pre className={classes.commandText}>{command}</pre>
              <span onClick={onCopy} onKeyDown={onCopy} role="presentation">
                <CopyTextButton
                  text={command}
                  tooltipText={`Copied the ${harness.label} command`}
                />
              </span>
            </div>
            {copied && (
              <Typography variant="caption" className={classes.pin}>
                Copy recorded against your identity, the asset and the commit.
              </Typography>
            )}
          </>
        ) : (
          <div className={classes.blocked}>
            <Box display="flex" alignItems="center" gridGap={8} mb={1}>
              <Chip size="small" label="unscored" variant="outlined" />
              <Typography variant="subtitle2">
                Install is blocked until this asset has an eval score
              </Typography>
            </Box>
            <Typography variant="body2" color="textSecondary">
              The score is the gate, not a decoration. Publish an eval gate
              report for this asset and it becomes installable on the next sync.
            </Typography>
            <Box mt={1.5}>
              <Link to="https://github.com/wololo-labs/skill-hub/blob/main/docs/SCORING.md">
                How to score an asset
              </Link>
            </Box>
          </div>
        )}

        {asset.commit && (
          <Typography variant="caption" className={classes.pin}>
            {asset.repo} at {asset.commit.slice(0, 12)}
          </Typography>
        )}
      </Box>
    </InfoCard>
  );
};
