import { useState } from 'react';
import { Box, Typography, makeStyles } from '@material-ui/core';
import { InfoCard, Link } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { HARNESSES } from '@internal/plugin-skill-hub-common';
import { Asset } from '../model';
import { skillHubApiRef } from '../api';
import { CopyCommand } from './CopyCommand';

const useStyles = makeStyles(theme => ({
  harnesses: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(2),
  },
  harness: {
    // A wrapping row of toggles rather than tabs. Tabs in a 340px column
    // silently clip the third harness instead of scrolling, and the install
    // panel gaining a harness must never be able to hide one.
    minHeight: 30,
    padding: theme.spacing(0.5, 1.25),
    borderRadius: theme.shape.borderRadius,
    border: `1px solid ${theme.palette.divider}`,
    background: 'transparent',
    color: theme.palette.textSubtle,
    font: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'color 120ms ease, border-color 120ms ease',
    '&:hover': { color: theme.palette.text.primary },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 1,
    },
  },
  harnessOn: {
    borderColor: theme.palette.primary.main,
    color: theme.palette.primary.main,
    background: theme.palette.action.selected,
  },
  command: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.default,
    border: `1px solid ${theme.palette.divider}`,
  },
  commandText: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    color: theme.palette.text.primary,
  },
  blocked: {
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    border: `1px dashed ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.default,
  },
  scoreLink: {
    // Standalone, so it is a target rather than a word in a sentence.
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 28,
    fontSize: 13.5,
  },
  blockedTitle: {
    fontWeight: 600,
    fontSize: 14,
    marginBottom: theme.spacing(0.5),
  },
  body: {
    color: theme.palette.textSubtle,
    fontSize: 13,
    lineHeight: 1.6,
  },
  pin: {
    display: 'block',
    marginTop: theme.spacing(1.5),
    color: theme.palette.textSubtle,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  receipt: {
    display: 'block',
    marginTop: theme.spacing(1),
    color: theme.palette.status.ok,
    fontSize: 12,
  },
  '@media (prefers-reduced-motion: reduce)': {
    harness: { transition: 'none' },
  },
}));

export interface InstallPanelProps {
  asset: Asset;
}

/**
 * The install gesture: pick a harness, copy one line, run it locally.
 *
 * The button is disabled for an unscored asset on purpose, and the panel says
 * why and where to go next rather than hiding the control. The score is the
 * gate; a gate that is invisible teaches nothing.
 */
export const InstallPanel = ({ asset }: InstallPanelProps) => {
  const classes = useStyles();
  const api = useApi(skillHubApiRef);
  const offered = HARNESSES.filter(
    h => asset.install[h.id] && asset.harnesses.includes(h.id),
  );
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);

  if (!offered.length) {
    return (
      <InfoCard title="Install">
        <Typography className={classes.body}>
          This asset publishes no install command. That happens when its path
          contains characters that would not survive being pasted into a shell.
        </Typography>
      </InfoCard>
    );
  }

  const index = Math.min(selected, offered.length - 1);
  const harness = offered[index];
  const command = asset.install[harness.id]!;
  const installable = Boolean(asset.score);

  return (
    <InfoCard
      title="Install"
      subheader={
        installable
          ? 'Pinned to the commit below. Run it where you want the asset.'
          : undefined
      }
    >
      <div
        className={classes.harnesses}
        role="radiogroup"
        aria-label="Target harness"
      >
        {offered.map((h, i) => (
          <button
            key={h.id}
            type="button"
            role="radio"
            aria-checked={i === index}
            onClick={() => {
              setSelected(i);
              setCopied(false);
            }}
            className={`${classes.harness} ${
              i === index ? classes.harnessOn : ''
            }`}
          >
            {h.label}
          </button>
        ))}
      </div>

      <Box>
        {installable ? (
          <>
            <div className={classes.command}>
              <pre className={classes.commandText}>{command}</pre>
              <CopyCommand
                text={command}
                label={harness.label}
                onCopied={() => {
                  setCopied(true);
                  void api.recordCopy(asset.entityRef, harness.id);
                }}
              />
            </div>
            {copied && (
              <Typography className={classes.receipt} role="status">
                Copy recorded against you, this asset and this commit.
              </Typography>
            )}
          </>
        ) : (
          <div className={classes.blocked}>
            <Typography className={classes.blockedTitle}>
              Install is blocked until this asset has a score
            </Typography>
            <Typography className={classes.body}>
              Nobody has run an eval gate against this asset, so there is
              nothing to say whether it works. Publish a gate report and it
              becomes installable on the next sync.
            </Typography>
            <Box mt={1.5}>
              <Link
                className={classes.scoreLink}
                to="https://github.com/wololo-labs/skill-hub/blob/main/docs/SCORING.md"
              >
                How to score an asset
              </Link>
            </Box>
          </div>
        )}

        {asset.commit && (
          <Typography className={classes.pin}>
            {asset.repo} at {asset.commit.slice(0, 12)}
          </Typography>
        )}
      </Box>
    </InfoCard>
  );
};
