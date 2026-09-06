import { Entity } from '@backstage/catalog-model';

/**
 * The annotation vocabulary the provider writes and the plugin reads. Both
 * sides import these from here so a rename cannot silently disable the
 * install gate.
 */
export const ANNOTATION_SOURCE_LOCATION = 'backstage.io/source-location';
export const ANNOTATION_EVAL_SCORE = 'wololo.dev/eval-score';
export const ANNOTATION_EVAL_SCORE_REF = 'wololo.dev/eval-score-ref';
export const ANNOTATION_HARNESSES = 'wololo.dev/harnesses';
export const ANNOTATION_INSTALL = 'wololo.dev/install';
export const ANNOTATION_REPO = 'wololo.dev/repo';
export const ANNOTATION_COMMIT = 'wololo.dev/commit';
export const ANNOTATION_ASSET_PATH = 'wololo.dev/asset-path';
/** The file whose contents the detail page renders as the asset body. */
export const ANNOTATION_BODY_PATH = 'wololo.dev/body-path';
export const ANNOTATION_APM_PACKAGE = 'wololo.dev/apm-package';

/** Harness slugs the install panel offers, in display order. */
export const HARNESSES = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'copilot', label: 'GitHub Copilot' },
  { id: 'codex', label: 'Codex' },
] as const;

export type HarnessId = (typeof HARNESSES)[number]['id'];

/** One metric from an eval gate report: candidate against its baseline. */
export interface EvalMetric {
  candidate: number;
  baseline: number;
}

/**
 * The score as carried on an entity. This is the shape the ainb-toolkit
 * catalogue generator emits, read back rather than reinvented.
 */
export interface EvalScore {
  verdict?: string;
  recorded?: string;
  source?: string;
  sourceVisibility?: string;
  metrics?: Record<string, EvalMetric>;
  /** The commit the score was measured at, when the publisher records one. */
  measuredCommit?: string;
}

/** Install command per harness, keyed by harness id. */
export type InstallCommands = Partial<Record<HarnessId, string>>;

function annotation(entity: Entity, key: string): string | undefined {
  const value = entity.metadata.annotations?.[key];
  return value === '' ? undefined : value;
}

export function readEvalScore(entity: Entity): EvalScore | undefined {
  const raw = annotation(entity, ANNOTATION_EVAL_SCORE);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function readInstallCommands(entity: Entity): InstallCommands {
  const raw = annotation(entity, ANNOTATION_INSTALL);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function readHarnesses(entity: Entity): string[] {
  return (annotation(entity, ANNOTATION_HARNESSES) ?? '')
    .split(',')
    .map(h => h.trim())
    .filter(Boolean);
}

/**
 * The install gate. An asset with no score is browsable and readable but not
 * installable: the score is the gate, not decoration.
 */
export function isInstallable(entity: Entity): boolean {
  return readEvalScore(entity) !== undefined;
}
