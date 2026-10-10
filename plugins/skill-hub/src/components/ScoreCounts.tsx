import { HeaderLabel } from '@backstage/core-components';
import { Asset, SCORE_STATE_LABEL, countByState } from '../model';

const ORDER = ['gain', 'no-gain', 'regressed', 'failed', 'unscored'] as const;

/**
 * One header count per score state. The counts are passed as text because
 * HeaderLabel prints a falsy value, which includes 0, as `<Unknown>`, and a
 * state with no assets is a real count, not an unknown one.
 */
export const ScoreCounts = ({
  assets,
  loading,
}: {
  assets: Asset[];
  loading: boolean;
}) => {
  const counts = countByState(assets);
  return (
    <>
      {ORDER.map(state => (
        <HeaderLabel
          key={state}
          label={SCORE_STATE_LABEL[state]}
          value={loading ? '...' : String(counts[state])}
        />
      ))}
    </>
  );
};
