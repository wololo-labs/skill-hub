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
  toAsset,
  visibleAssets,
} from './model';

function entity(options: {
  name: string;
  type?: string;
  kind?: string;
  owner?: string;
  scored?: boolean;
  harnesses?: string;
  description?: string;
}): Entity {
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
        ...(options.scored
          ? { [ANNOTATION_EVAL_SCORE]: '{"verdict":"PASS"}' }
          : {}),
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

describe('applyFacets', () => {
  it('narrows by type, owner, harness and score together', () => {
    expect(
      applyFacets(assets, { ...EMPTY_FACETS, type: ['hook'] }).map(a => a.name),
    ).toEqual(['apple']);
    expect(
      applyFacets(assets, { ...EMPTY_FACETS, score: ['scored'] }).map(a => a.name),
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
    // With the hook type selected, the score facet must count only hooks:
    // offering "scored 1" here would promise a result the filter cannot give.
    const counts = facetCounts(assets, { ...EMPTY_FACETS, type: ['hook'] }, 'score');
    expect(counts.get('unscored')).toBe(1);
    expect(counts.get('scored')).toBeUndefined();
  });

  it('counts its own dimension against everything else', () => {
    const counts = facetCounts(assets, EMPTY_FACETS, 'type');
    expect(counts.get('skill')).toBe(4);
    expect(counts.get('hook')).toBe(1);
  });
});
