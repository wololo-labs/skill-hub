import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { Asset } from '../model';
import { ScoreCounts } from './ScoreCounts';

const asset = (verdict?: string): Asset =>
  ({ score: verdict ? { verdict } : undefined }) as unknown as Asset;

describe('the header score counts', () => {
  it('shows a zero as 0, not as Unknown', async () => {
    await renderInTestApp(
      <ScoreCounts assets={[asset('PASS'), asset()]} loading={false} />,
      {},
    );
    // No asset is in the failed state, which is exactly the case HeaderLabel
    // renders as <Unknown> when handed the number 0.
    expect(await screen.findByText('failed gate')).toBeInTheDocument();
    expect(screen.queryByText('<Unknown>')).not.toBeInTheDocument();
  });

  it('shows a placeholder, not a count, while loading', async () => {
    await renderInTestApp(<ScoreCounts assets={[]} loading />, {});
    expect((await screen.findAllByText('...')).length).toBe(5);
  });
});
