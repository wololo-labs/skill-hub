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

/** The list as the browse page shows it: filtered, then ordered. */
export function visibleAssets(assets: Asset[], facets: Facets): Asset[] {
  return applyFacets(assets, facets).sort(byScoreThenName);
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
  const counts = new Map<string, number>();
  for (const asset of applyFacets(assets, others)) {
    for (const value of values[dimension](asset)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

/** Route for an asset detail page, relative to the plugin root. */
export function assetPath(asset: Asset): string {
  const { kind, namespace, name } = parseEntityRef(asset.entityRef);
  return `${kind.toLowerCase()}/${namespace}/${name}`;
}
