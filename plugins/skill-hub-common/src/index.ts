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
/** The raw `dependencies.apm` entries of a package, as a JSON array. */
export const ANNOTATION_APM_DEPENDENCIES = 'wololo.dev/apm-dependencies';
/**
 * Why a package that passed its own gate is still not installable: the
 * dependencies it pulls in that nobody vouched for, as a JSON array of
 * `InstallBlocker`. Absent when nothing blocks it.
 */
export const ANNOTATION_INSTALL_BLOCKED_BY = 'wololo.dev/install-blocked-by';

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

/** One dependency that stops an otherwise passing package being installed. */
export interface InstallBlocker {
  /** The dependency as the package wrote it. */
  ref: string;
  /**
   * `unresolved`: not a package in this catalogue. `unscored`: no gate report.
   * `failed`: the gate did not pass. `blocked`: it is itself held back by one
   * of its own dependencies.
   */
  reason: 'unresolved' | 'unscored' | 'failed' | 'blocked';
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

export function readInstallBlockers(entity: Entity): InstallBlocker[] {
  const raw = annotation(entity, ANNOTATION_INSTALL_BLOCKED_BY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // An annotation that says something blocks the install and cannot be read
    // is still a block, never an absence of one.
    return [{ ref: 'unreadable blocker list', reason: 'unresolved' }];
  }
}

/**
 * The install gate. An asset is installable only when an eval gate has been run
 * against it and passed, and nothing it pulls in at install time is held back.
 * Unmeasured and failed are both blocked: a score that says the asset does not
 * work is not a reason to hand over the command.
 */
export function isInstallable(entity: Entity): boolean {
  return (
    passedGate(readEvalScore(entity)) && readInstallBlockers(entity).length === 0
  );
}
