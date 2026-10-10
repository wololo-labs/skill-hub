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
  /**
   * The gate's aggregate statistics over every case. Absent when the report
   * carries none, which reads as no demonstrated gain, never as a gain.
   */
  stats?: EvalStats;
}

/** The part of the gate report's `stats` block the catalogue states. */
export interface EvalStats {
  meanDelta?: number;
  ciLow?: number;
  ciHigh?: number;
  confidence?: number;
  significantImprovement?: boolean;
  significantRegression?: boolean;
}

/**
 * What the catalogue can honestly say about an asset's score.
 *
 * `gain`: passed and the improvement is statistically significant.
 * `no-gain`: passed, but nothing shows it beats the model alone.
 * `regressed`: the gate's verdict is regression.
 * `failed`: any other verdict that is not a pass (`refused`, or none).
 * `unscored`: no report at all.
 */
export type ScoreState =
  | 'gain'
  | 'no-gain'
  | 'regressed'
  | 'failed'
  | 'unscored';

export function scoreState(score: EvalScore | undefined): ScoreState {
  if (!score) return 'unscored';
  const verdict = (score.verdict ?? '').toUpperCase();
  if (verdict === 'REGRESSION') return 'regressed';
  if (verdict !== 'PASS') return 'failed';
  return score.stats?.significantImprovement === true ? 'gain' : 'no-gain';
}

/**
 * Whether the score was measured at a different commit from the one the asset
 * is pinned to. Unknown on either side is not stale: there is nothing to
 * compare, and the score is shown either way.
 */
export function isScoreStale(
  score: EvalScore | undefined,
  pinnedCommit: string | undefined,
): boolean {
  const measured = score?.measuredCommit;
  if (!measured || !pinnedCommit) return false;
  return (
    !pinnedCommit.startsWith(measured) && !measured.startsWith(pinnedCommit)
  );
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
 * Whether a score records a gate that passed. A report with no verdict has not
 * said the asset works, so it reads the same as a failure: the surfaces treat
 * anything other than PASS as a failed gate, and so does the install gate.
 */
export function passedGate(score: EvalScore | undefined): boolean {
  return (score?.verdict ?? '').toUpperCase() === 'PASS';
}

/**
 * The install gate. An asset is installable only when an eval gate has been run
 * against it and passed. Unmeasured and failed are both blocked: a score that
 * says the asset does not work is not a reason to hand over the command.
 */
export function isInstallable(entity: Entity): boolean {
  return passedGate(readEvalScore(entity));
}
