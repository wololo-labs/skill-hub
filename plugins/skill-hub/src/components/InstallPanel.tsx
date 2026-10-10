import { useRef, useState } from 'react';
import { Box, Typography, makeStyles } from '@material-ui/core';
import { InfoCard, Link } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { APM_TARGETS_VERSION, HARNESSES, passedGate } from '@internal/plugin-skill-hub-common';
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
  commandRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
  },
  // The command scrolls rather than wraps. Breaking a 40 character sha across
  // a line is what stops a developer verifying what they are about to paste
  // into a shell, and this is the one line the product exists to hand over.
  commandScroll: {
    flex: 1,
    minWidth: 0,
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.default,
    border: `1px solid ${theme.palette.divider}`,
    overflowX: 'auto',
  },
  commandText: {
    margin: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: 1.7,
    // Only newlines wrap. A token never breaks.
    whiteSpace: 'pre',
    color: theme.palette.text.primary,
  },
  blocked: {
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    border: `1px dashed ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.default,
  },
  blockedTitle: {
    fontWeight: 600,
    fontSize: 14,
    marginBottom: theme.spacing(0.5),
  },
  staleText: {
    margin: 0,
  },
  stale: {
    padding: theme.spacing(1.25, 1.5),
    marginBottom: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.warningBackground,
    color: theme.palette.text.primary,
    fontSize: 12.5,
    lineHeight: 1.55,
  },
  acknowledge: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.25),
    // The whole label is the target, so the hit area is not the 13px the
    // browser gives a bare checkbox.
    minHeight: 32,
    padding: theme.spacing(0.5, 0.75),
    marginLeft: theme.spacing(-0.75),
    borderRadius: theme.shape.borderRadius,
    font: 'inherit',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    '&:hover': { backgroundColor: theme.palette.action.hover },
    '&:focus-within': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 1,
    },
  },
  checkbox: {
    // 24px, the WCAG 2.2 AA minimum, on the control itself rather than only
    // on the label around it.
    width: 24,
    height: 24,
    margin: 0,
    accentColor: theme.palette.primary.main,
    cursor: 'pointer',
  },
  body: {
    color: theme.palette.textSubtle,
    fontSize: 13,
    lineHeight: 1.6,
  },
  scoreLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 28,
    fontSize: 13.5,
  },
  pin: {
    display: 'block',
    marginTop: theme.spacing(1.5),
    color: theme.palette.textSubtle,
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    overflowWrap: 'anywhere',
  },
  receipt: {
    display: 'block',
    marginTop: theme.spacing(1),
    color: theme.palette.status.ok,
    fontSize: 12,
  },
}));

export interface InstallPanelProps {
  asset: Asset;
  /** True when the score was measured at a commit this asset is not pinned to. */
  stale?: boolean;
}

/**
 * The install gesture: pick a harness, copy one line, run it locally.
 *
 * Two things are refused here rather than explained away. An asset with no
 * eval gate report has no command at all, because the score is the gate. An
 * asset whose score was measured against a different tree is not treated as
 * scored either: it is closer to unmeasured than to measured, and the product
 * already knows the difference, so it asks for that to be acknowledged before
 * it hands anything over.
 */
/**
 * Why the command is not on offer. Three different situations end here and the
 * difference matters to whoever is reading: nobody measured this, somebody
 * measured it and it failed, or it passed against a different tree.
 */
function blocked(failed: boolean, passed: boolean): { title: string; body: string } {
  if (failed) {
    return {
      title: 'Install is blocked: the eval gate failed',
      body: 'The gate that ran against this asset did not pass, so the measurement above is a record of it not working. Fix the asset and publish a passing report, and it becomes installable on the next sync.',
    };
  }
  if (passed) {
    return {
      title: 'Confirm you want a command the score does not cover',
      body: 'The measurement above describes a different tree. Tick the box to take the command anyway.',
    };
  }
  return {
    title: 'Install is blocked until this asset has a score',
    body: 'Nobody has run an eval gate against this asset, so there is nothing to say whether it works. Publish a gate report and it becomes installable on the next sync.',
  };
}

export const InstallPanel = ({ asset, stale = false }: InstallPanelProps) => {
  const classes = useStyles();
  const api = useApi(skillHubApiRef);
  const offered = HARNESSES.filter(
    h => asset.install[h.id] && asset.harnesses.includes(h.id),
  );
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  if (!offered.length) {
    return (
      <InfoCard title="Install">
        <Typography className={classes.body}>
          This asset publishes no install command. That happens when its path
          contains characters that would not survive being pasted into a shell,
          or when none of the targets its pack declares is one this hub offers.
          The hub's list follows APM {APM_TARGETS_VERSION}, so a target newer
          than that is the hub's gap to fill, not a mistake in the pack. The
          sync warnings name the pack and the targets.
        </Typography>
      </InfoCard>
    );
  }

  const index = Math.min(selected, offered.length - 1);
  const harness = offered[index];
  const command = asset.install[harness.id]!;
  // Presence of a score is not the gate; a passing verdict is. A report that
  // says the asset failed blocks the command exactly as hard as no report at
  // all, and says so in different words, because the two are not the same
  // problem for whoever is reading.
  const passed = passedGate(asset.score);
  const failed = Boolean(asset.score) && !passed;
  const installable = passed && (!stale || acknowledged);

  // A radiogroup promises one tab stop and arrow keys. Without this it
  // delivers three tab stops and dead arrows, which is worse than no role.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    const jump = { Home: 0, End: offered.length - 1 }[event.key];
    const next =
      step !== undefined
        ? (index + step + offered.length) % offered.length
        : jump;
    if (next === undefined) return;
    event.preventDefault();
    setSelected(next);
    setCopied(false);
    radios.current[next]?.focus();
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
      <div
        className={classes.harnesses}
        role="radiogroup"
        aria-label="Target harness"
      >
        {offered.map((h, i) => (
          <button
            key={h.id}
            ref={el => {
              radios.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={i === index}
            // Roving tabindex: the group is one stop, arrows move within it.
            tabIndex={i === index ? 0 : -1}
            onKeyDown={onKeyDown}
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

      {passed && stale && (
        <div className={classes.stale}>
          <p className={classes.staleText}>
            This asset's score was measured against a different commit from the
            one this command installs, so it does not describe what you would
            be running.
          </p>
          <label className={classes.acknowledge}>
            <input
              type="checkbox"
              className={classes.checkbox}
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
            />
            Install anyway
          </label>
        </div>
      )}

      <Box>
        {installable ? (
          <>
            <div className={classes.commandRow}>
              <div className={classes.commandScroll}>
                <pre className={classes.commandText}>{command}</pre>
              </div>
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
                Copy recorded: {asset.name} for {harness.label}.
              </Typography>
            )}
          </>
        ) : (
          <div className={classes.blocked}>
            <Typography className={classes.blockedTitle}>
              {blocked(failed, passed).title}
            </Typography>
            <Typography className={classes.body}>
              {blocked(failed, passed).body}
            </Typography>
            {!passed && (
              <Box mt={1.5}>
                <Link
                  className={classes.scoreLink}
                  to="https://github.com/wololo-labs/skill-hub/blob/main/docs/SCORING.md"
                >
                  How to score an asset
                </Link>
              </Box>
            )}
          </div>
        )}

        {asset.commit && (
          // The full sha, not a prefix: it is here to be compared against the
          // one inside the command, which a 12 character stub cannot do.
          <Typography className={classes.pin}>
            {asset.repo}
            <br />
            {asset.commit}
          </Typography>
        )}
      </Box>
    </InfoCard>
  );
};
