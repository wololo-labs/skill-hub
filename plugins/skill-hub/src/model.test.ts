import { Entity } from '@backstage/catalog-model';
import {
  ANNOTATION_EVAL_SCORE,
  ANNOTATION_HARNESSES,
  ANNOTATION_INSTALL,
} from '@internal/plugin-skill-hub-common';
import {
  EMPTY_FACETS,
  applyFacets,
  facetCounts,
  scoreStateOf,
  countByState,
  toAsset,
  visibleAssets,
} from './model';

const passOnly = { verdict: 'PASS' };

function entity(options: {
  name: string;
  type?: string;
  kind?: string;
  owner?: string;
  scored?: boolean;
  /** A full score annotation, for the states `scored` cannot express. */
  score?: object;
  harnesses?: string;
  description?: string;
}): Entity {
  const score = options.score ?? (options.scored ? passOnly : undefined);
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: options.kind ?? 'AiResource',
    metadata: {
      name: options.name,
      namespace: 'wololo-labs-estate',
      description: options.description,
      annotations: {
        [ANNOTATION_HARNESSES]: options.harnesses ?? 'claude,copilot,codex',
        [ANNOTATION_INSTALL]: JSON.stringify({ claude: 'apm install x' }),
        ...(score ? { [ANNOTATION_EVAL_SCORE]: JSON.stringify(score) } : {}),
      },
    },
    spec: {
      type: options.type ?? 'skill',
      owner: options.owner ?? 'group:default/team-ai-platform',
    },
  };
}

const assets = [
  entity({ name: 'zebra', scored: false }),
  entity({ name: 'apple', scored: false, type: 'hook' }),
  entity({ name: 'middle', scored: true }),
  entity({ name: 'other-owner', owner: 'group:default/team-two' }),
  entity({ name: 'claude-only', harnesses: 'claude' }),
].map(toAsset);

describe('visibleAssets', () => {
  it('puts what clears the gate first, then orders by name', () => {
    // The catalogue's claim is that the score decides installability, so the
    // installable assets are the ones worth seeing without scrolling.
    expect(visibleAssets(assets, EMPTY_FACETS).map(a => a.name)).toEqual([
      'middle',
      'apple',
      'claude-only',
      'other-owner',
      'zebra',
    ]);
  });
});

describe('searchRank', () => {
  it('puts an exact name above a description mention', () => {
    // The hurried developer types the asset's name. Returning something that
    // merely mentions it first is the failure this ordering exists to stop.
    const exact = toAsset(entity({ name: 'commit' }));
    const mentions = toAsset(
      entity({ name: 'code-reviewer', description: 'reviews a commit' }),
    );
    const ranked = visibleAssets([mentions, exact], {
      ...EMPTY_FACETS,
      text: 'commit',
    });
    expect(ranked.map(a => a.name)).toEqual(['commit', 'code-reviewer']);
  });

  it('puts a prefix above a mid-string match', () => {
    const prefix = toAsset(entity({ name: 'commit-helper' }));
    const middle = toAsset(entity({ name: 'auto-commit-thing' }));
    expect(
      visibleAssets([middle, prefix], { ...EMPTY_FACETS, text: 'commit' }).map(
        a => a.name,
      ),
    ).toEqual(['commit-helper', 'auto-commit-thing']);
  });
});

describe('applyFacets', () => {
  it('narrows by type, owner, harness and score together', () => {
    expect(
      applyFacets(assets, { ...EMPTY_FACETS, type: ['hook'] }).map(a => a.name),
    ).toEqual(['apple']);
    expect(
      applyFacets(assets, { ...EMPTY_FACETS, score: ['no-gain'] }).map(a => a.name),
    ).toEqual(['middle']);
    expect(
      applyFacets(assets, { ...EMPTY_FACETS, owner: ['team-two'] }).map(a => a.name),
    ).toEqual(['other-owner']);
  });

  it('treats a harness filter as any of, not all of', () => {
    expect(
      applyFacets(assets, { ...EMPTY_FACETS, harness: ['codex'] }).map(a => a.name),
    ).toEqual(['zebra', 'apple', 'middle', 'other-owner']);
  });

  it('searches name and description', () => {
    const withText = [
      ...assets,
      toAsset(entity({ name: 'findme', description: 'a needle in here' })),
    ];
    expect(
      applyFacets(withText, { ...EMPTY_FACETS, text: 'needle' }).map(a => a.name),
    ).toEqual(['findme']);
  });
});

describe('facetCounts', () => {
  it('counts against the other facets, so no offered count is a dead end', () => {
    // With the hook type selected the pool is one unscored hook, so "scored"
    // must not be offered: it would promise a result the filter cannot give.
    const counts = facetCounts(assets, { ...EMPTY_FACETS, type: ['hook'] }, 'score');
    expect(counts.get('no-gain')).toBeUndefined();
  });

  it('drops a value every asset has, because it cannot narrow anything', () => {
    // Every asset targets claude, so a claude filter would change nothing.
    // A control that cannot change the result is not a control.
    expect(facetCounts(assets, EMPTY_FACETS, 'harness').get('claude')).toBeUndefined();
    expect(facetCounts(assets, EMPTY_FACETS, 'harness').get('codex')).toBe(4);
  });

  it('keeps a value that is already selected, so a filter never vanishes', () => {
    const counts = facetCounts(
      assets,
      { ...EMPTY_FACETS, harness: ['claude'] },
      'harness',
    );
    expect(counts.get('claude')).toBe(5);
  });

  it('counts its own dimension against everything else', () => {
    const counts = facetCounts(assets, EMPTY_FACETS, 'type');
    expect(counts.get('skill')).toBe(4);
    expect(counts.get('hook')).toBe(1);
  });
});

describe('the four score states in the browse model', () => {
  const states = [
    entity({ name: 'a-unscored' }),
    entity({ name: 'b-regressed', score: { verdict: 'REGRESSION' } }),
    entity({ name: 'c-nogain', score: { verdict: 'PASS' } }),
    entity({
      name: 'd-gain',
      score: { verdict: 'PASS', stats: { significantImprovement: true } },
    }),
  ].map(toAsset);

  it('gives every asset its own state, not scored or unscored', () => {
    expect(states.map(scoreStateOf)).toEqual([
      'unscored',
      'regressed',
      'no-gain',
      'gain',
    ]);
  });

  it('filters by each state and counts each one', () => {
    for (const state of ['unscored', 'regressed', 'no-gain', 'gain'] as const) {
      expect(
        applyFacets(states, { ...EMPTY_FACETS, score: [state] }).length,
      ).toBe(1);
    }
    expect([...facetCounts(states, EMPTY_FACETS, 'score').keys()].sort()).toEqual(
      ['gain', 'no-gain', 'regressed', 'unscored'],
    );
  });

  it('lists a measured gain first and an unscored asset last', () => {
    expect(visibleAssets(states, EMPTY_FACETS).map(a => a.name)).toEqual([
      'd-gain',
      'c-nogain',
      'b-regressed',
      'a-unscored',
    ]);
  });
});

describe('countByState', () => {
  it('counts all five states, so the header never hides one', () => {
    const everything = [
      entity({ name: 'a' }),
      entity({ name: 'b', score: { verdict: 'REGRESSION' } }),
      entity({ name: 'c', score: { verdict: 'REFUSED' } }),
      entity({ name: 'd', score: { verdict: 'PASS' } }),
      entity({
        name: 'e',
        score: { verdict: 'PASS', stats: { significantImprovement: true } },
      }),
    ].map(toAsset);
    const counts = countByState(everything);
    expect(counts).toEqual({
      unscored: 1,
      regressed: 1,
      failed: 1,
      'no-gain': 1,
      gain: 1,
    });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(
      everything.length,
    );
  });
});
