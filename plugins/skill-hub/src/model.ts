import { Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import {
  ANNOTATION_ASSET_PATH,
  ANNOTATION_COMMIT,
  ANNOTATION_EVAL_SCORE_REF,
  ANNOTATION_REPO,
  EvalScore,
  InstallCommands,
  readEvalScore,
  readHarnesses,
  readInstallCommands,
} from '@internal/plugin-skill-hub-common';

/** One row on the browse page: an entity, flattened to what the hub shows. */
export interface Asset {
  entity: Entity;
  entityRef: string;
  name: string;
  title: string;
  description: string;
  /** `skill`, `agent`, `hook`, `mcp-server`, `pack`, and so on. */
  type: string;
  owner: string;
  repo?: string;
  commit?: string;
  path?: string;
  harnesses: string[];
  score?: EvalScore;
  scoreRef?: string;
  install: InstallCommands;
  tags: string[];
}

const humanKind: Record<string, string> = {
  System: 'pack',
};

export function toAsset(entity: Entity): Asset {
  const annotations = entity.metadata.annotations ?? {};
  const specType =
    typeof entity.spec?.type === 'string' ? entity.spec.type : undefined;
  const owner =
    typeof entity.spec?.owner === 'string' ? entity.spec.owner : 'unknown';
  return {
    entity,
    entityRef: stringifyEntityRef(entity),
    name: entity.metadata.name,
    title: entity.metadata.title ?? entity.metadata.name,
    description: entity.metadata.description ?? '',
    type: specType ?? humanKind[entity.kind] ?? entity.kind.toLowerCase(),
    owner: shortOwner(owner),
    repo: annotations[ANNOTATION_REPO],
    commit: annotations[ANNOTATION_COMMIT],
    path: annotations[ANNOTATION_ASSET_PATH],
    harnesses: readHarnesses(entity),
    score: readEvalScore(entity),
    scoreRef: annotations[ANNOTATION_EVAL_SCORE_REF],
    install: readInstallCommands(entity),
    tags: entity.metadata.tags ?? [],
  };
}

function shortOwner(ref: string): string {
  try {
    return parseEntityRef(ref, { defaultKind: 'group', defaultNamespace: 'default' })
      .name;
  } catch {
    return ref;
  }
}

export type ScoreState = 'scored' | 'unscored';

export function scoreState(asset: Asset): ScoreState {
  return asset.score ? 'scored' : 'unscored';
}

export interface Facets {
  type: string[];
  owner: string[];
  harness: string[];
  score: ScoreState[];
  text: string;
}

export const EMPTY_FACETS: Facets = {
  type: [],
  owner: [],
  harness: [],
  score: [],
  text: '',
};

/**
 * Scored assets first, then alphabetically.
 *
 * The catalogue's whole claim is that the score decides whether an asset can
 * be installed, so the assets that clear the gate are the ones worth reading
 * first. The facet counts still state the true ratio, so nothing is hidden by
 * this: an estate that is mostly unscored still says so, at the top.
 */
export function byScoreThenName(a: Asset, b: Asset): number {
  const scored = Number(Boolean(b.score)) - Number(Boolean(a.score));
  return scored !== 0 ? scored : a.title.localeCompare(b.title);
}

export function applyFacets(assets: Asset[], facets: Facets): Asset[] {
  const text = facets.text.trim().toLowerCase();
  return assets.filter(asset => {
    if (facets.type.length && !facets.type.includes(asset.type)) return false;
    if (facets.owner.length && !facets.owner.includes(asset.owner)) return false;
    if (
      facets.harness.length &&
      !facets.harness.some(h => asset.harnesses.includes(h))
    ) {
      return false;
    }
    if (facets.score.length && !facets.score.includes(scoreState(asset))) {
      return false;
    }
    if (
      text &&
      ![asset.name, asset.title, asset.description, asset.repo ?? '', ...asset.tags]
        .join(' ')
        .toLowerCase()
        .includes(text)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * How well an asset answers a search. Higher is better.
 *
 * Without this, typing an asset's exact name can put that asset second,
 * behind something that merely mentions the word in its description, which is
 * the single most natural gesture a hurried developer makes.
 */
export function searchRank(asset: Asset, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = asset.name.toLowerCase();
  const title = asset.title.toLowerCase();
  if (name === q || title === q) return 4;
  if (name.startsWith(q) || title.startsWith(q)) return 3;
  if (name.includes(q) || title.includes(q)) return 2;
  if ((asset.description ?? '').toLowerCase().includes(q)) return 1;
  return 0;
}

/**
 * The list as the browse page shows it: filtered, then ordered.
 *
 * With a query, relevance leads and the score breaks ties. Without one, the
 * score leads, because the catalogue's claim is that it decides whether an
 * asset can be installed at all.
 */
export function visibleAssets(assets: Asset[], facets: Facets): Asset[] {
  const filtered = applyFacets(assets, facets);
  const query = facets.text.trim();
  if (!query) return filtered.sort(byScoreThenName);
  return filtered.sort((a, b) => {
    const rank = searchRank(b, query) - searchRank(a, query);
    return rank !== 0 ? rank : byScoreThenName(a, b);
  });
}

/**
 * Counts every facet value against the assets that survive the *other*
 * facets, so a count never promises a result the filter cannot deliver.
 */
export function facetCounts(
  assets: Asset[],
  facets: Facets,
  dimension: keyof Omit<Facets, 'text'>,
): Map<string, number> {
  const values: Record<keyof Omit<Facets, 'text'>, (a: Asset) => string[]> = {
    type: a => [a.type],
    owner: a => [a.owner],
    harness: a => a.harnesses,
    score: a => [scoreState(a)],
  };

  const others = { ...facets, [dimension]: [] } as Facets;
  const pool = applyFacets(assets, others);
  const counts = new Map<string, number>();
  for (const asset of pool) {
    for (const value of values[dimension](asset)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  // A value every asset carries cannot narrow anything, so offering it is a
  // control that looks like one and is not. Selected values stay, so a filter
  // already applied never vanishes from under the user.
  const selected = facets[dimension] as string[];
  for (const [value, count] of counts) {
    if (count === pool.length && pool.length > 0 && !selected.includes(value)) {
      counts.delete(value);
    }
  }
  return counts;
}

/** Route for an asset detail page, relative to the plugin root. */
export function assetPath(asset: Asset): string {
  const { kind, namespace, name } = parseEntityRef(asset.entityRef);
  return `${kind.toLowerCase()}/${namespace}/${name}`;
}
