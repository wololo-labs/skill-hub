import '@testing-library/jest-dom';
import { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@material-ui/core';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { EvalScore, readEvalScore } from '@internal/plugin-skill-hub-common';
import { Asset } from '../model';
import { skillHubApiRef } from '../api';
import { InstallPanel } from './InstallPanel';
import { ScoreBadge } from './ScoreBadge';

const PINNED = 'a'.repeat(40);
const MEASURED = 'b'.repeat(40);

const ci = {
  meanDelta: 0.0003,
  ciLow: -0.0102,
  ciHigh: 0.0105,
  confidence: 0.95,
};

const SCORES: Record<string, EvalScore | undefined> = {
  gain: {
    verdict: 'PASS',
    measuredCommit: PINNED,
    stats: {
      ...ci,
      meanDelta: 0.052,
      ciLow: 0.021,
      ciHigh: 0.09,
      significantImprovement: true,
    },
  },
  'no gain': {
    verdict: 'PASS',
    measuredCommit: PINNED,
    stats: { ...ci, significantImprovement: false },
  },
  regressed: { verdict: 'REGRESSION', measuredCommit: PINNED },
  unscored: undefined,
};

const asset = (score?: EvalScore): Asset =>
  ({
    entityRef: 'airesource:default/x',
    name: 'x',
    title: 'x',
    type: 'skill',
    owner: 'team',
    repo: 'wololo-labs/estate',
    commit: PINNED,
    harnesses: ['claude'],
    install: { claude: 'apm install wololo-labs/estate/x#claude' },
    score,
    blockedBy: [],
    tags: [],
  } as unknown as Asset);

const api = { getAssetBody: jest.fn(), recordCopy: jest.fn() };

const wrap = (node: ReactNode) =>
  renderInTestApp(
    <ThemeProvider
      theme={createTheme({
        palette: {
          highlight: '#eef',
          warningBackground: '#fed',
          warningText: '#630',
          infoText: '#223',
          textSubtle: '#666',
          status: { ok: '#2a2', error: '#c22', warning: '#a60' },
        } as any,
      })}
    >
      {node}
    </ThemeProvider>,
    { apis: [[skillHubApiRef, api]] },
  );

const command = () => screen.queryByText(/apm install/);

describe('the four score states', () => {
  it('measured gain: says so and offers the command', async () => {
    wrap(
      <>
        <ScoreBadge score={SCORES.gain} pinnedCommit={PINNED} />
        <InstallPanel asset={asset(SCORES.gain)} />
      </>,
    );
    // The badge shows the gain over the model alone, not the candidate's mean.
    expect(
      await screen.findAllByText('+0.052 (CI 0.021 to 0.090)'),
    ).not.toHaveLength(0);
    expect(command()).toBeInTheDocument();
    expect(screen.queryByText(/No measured gain/)).not.toBeInTheDocument();
  });

  it('no demonstrated gain: says so, offers the command and warns in those words', async () => {
    wrap(
      <>
        <ScoreBadge score={SCORES['no gain']} pinnedCommit={PINNED} />
        <InstallPanel asset={asset(SCORES['no gain'])} />
      </>,
    );
    expect(
      await screen.findAllByText('no measured gain over the model alone'),
    ).not.toHaveLength(0);
    expect(command()).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'No measured gain over the model alone',
    );
  });

  it('regressed: says so and has no install control at all', async () => {
    wrap(
      <>
        <ScoreBadge score={SCORES.regressed} pinnedCommit={PINNED} />
        <InstallPanel asset={asset(SCORES.regressed)} />
      </>,
    );
    expect(await screen.findAllByText('regressed')).not.toHaveLength(0);
    expect(command()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText(/the asset regressed/)).toBeInTheDocument();
  });

  it('a pass that is measurably worse: regressed, and no install control', async () => {
    const worse: EvalScore = {
      verdict: 'PASS',
      measuredCommit: PINNED,
      stats: { ...ci, significantImprovement: false, significantRegression: true },
    };
    wrap(
      <>
        <ScoreBadge score={worse} pinnedCommit={PINNED} />
        <InstallPanel asset={asset(worse)} />
      </>,
    );
    expect(await screen.findAllByText('regressed')).not.toHaveLength(0);
    expect(command()).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('unscored: says so and has no install control', async () => {
    wrap(
      <>
        <ScoreBadge score={undefined} pinnedCommit={PINNED} />
        <InstallPanel asset={asset(undefined)} />
      </>,
    );
    expect(await screen.findByText('unscored')).toBeInTheDocument();
    expect(command()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });
});

describe('staleness', () => {
  it('shows both commits beside the badge and keeps the score visible', async () => {
    const score = { ...SCORES['no gain']!, measuredCommit: MEASURED };
    wrap(<ScoreBadge score={score} pinnedCommit={PINNED} />);
    expect(
      await screen.findAllByText('no measured gain over the model alone'),
    ).not.toHaveLength(0);
    expect(
      screen.getByText(
        `stale: scored at ${MEASURED.slice(0, 7)}, pinned ${PINNED.slice(
          0,
          7,
        )}`,
      ),
    ).toBeInTheDocument();
  });

  it('shows nothing extra when the commits match', async () => {
    wrap(<ScoreBadge score={SCORES.gain} pinnedCommit={PINNED} />);
    await screen.findAllByText('measured gain');
    expect(screen.queryByText(/stale:/)).not.toBeInTheDocument();
  });

  it('shows the staleness on a regressed score as well', async () => {
    const score = { ...SCORES.regressed!, measuredCommit: MEASURED };
    wrap(<ScoreBadge score={score} pinnedCommit={PINNED} />);
    expect(await screen.findByText(/stale: scored at/)).toBeInTheDocument();
  });
});

describe('a legacy score with values of the wrong type', () => {
  it('renders as text and does not take the list down', async () => {
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'System',
      metadata: {
        name: 'legacy',
        annotations: {
          'wololo.dev/eval-score': JSON.stringify({
            verdict: 'PASS',
            measuredCommit: 1234567,
            metrics: { qe: { candidate: 'n/a', baseline: '0.4' } },
            stats: { ciLow: 'low', ciHigh: 'high', meanDelta: 'x' },
          }),
        },
      },
    } as any;
    wrap(<ScoreBadge score={readEvalScore(entity)} pinnedCommit={PINNED} />);
    expect(
      await screen.findAllByText('no measured gain over the model alone'),
    ).not.toHaveLength(0);
  });
});

describe('a score with no verdict', () => {
  it('says the verdict is missing rather than showing a red SCORED', async () => {
    wrap(<ScoreBadge score={{}} pinnedCommit={PINNED} />);
    expect(await screen.findByText('verdict missing')).toBeInTheDocument();
    expect(screen.queryByText(/^scored$/i)).not.toBeInTheDocument();
  });
});

describe('the two warnings on one panel', () => {
  it('give the stale warning and the no-gain note different styles', async () => {
    const score = { ...SCORES['no gain']!, measuredCommit: MEASURED };
    wrap(<InstallPanel asset={asset(score)} stale />);
    const note = await screen.findByRole('note');
    const staleBox = screen.getByText(/measured against a different commit/)
      .parentElement!;
    expect(note.className).not.toBe(staleBox.className);
  });
});
