import { useEffect, useRef, useState } from 'react';
import { Button, Tooltip, makeStyles } from '@material-ui/core';
import CopyIcon from '@material-ui/icons/FileCopyOutlined';
import DoneIcon from '@material-ui/icons/Done';

const useStyles = makeStyles(theme => ({
  button: {
    flex: '0 0 auto',
    minWidth: 0,
    padding: theme.spacing(0.5, 1),
    fontSize: 12,
    fontWeight: 600,
  },
  icon: {
    fontSize: 15,
    marginRight: 4,
  },
  done: {
    color: theme.palette.status.ok,
  },
}));

export interface CopyCommandProps {
  text: string;
  /** Names the thing being copied, for the button's accessible label. */
  label: string;
  onCopied?: () => void;
}

/**
 * Copy, with the outcome actually reported.
 *
 * The clipboard API needs a secure context, which a hub served over plain HTTP
 * on an internal host will not have, so this falls back to a selection copy
 * rather than failing silently. Silence is the one outcome a copy button must
 * never have: the whole install gesture is this button working.
 */
export const CopyCommand = ({ text, label, onCopied }: CopyCommandProps) => {
  const classes = useStyles();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2400);
    if (ok) onCopied?.();
  };

  const copied = state === 'copied';
  return (
    <Tooltip
      title={
        state === 'failed'
          ? 'Could not reach the clipboard. Select the command and copy it manually.'
          : `Copy the ${label} command`
      }
    >
      <Button
        className={classes.button}
        size="small"
        variant="outlined"
        onClick={copy}
        aria-label={`Copy the ${label} install command`}
      >
        {copied ? (
          <DoneIcon className={`${classes.icon} ${classes.done}`} />
        ) : (
          <CopyIcon className={classes.icon} />
        )}
        {copied ? 'Copied' : state === 'failed' ? 'Failed' : 'Copy'}
      </Button>
    </Tooltip>
  );
};

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
