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
/** Why an asset offers no install command, when it offers none. */
export const ANNOTATION_INSTALL_UNAVAILABLE = 'wololo.dev/install-unavailable';
export const ANNOTATION_REPO = 'wololo.dev/repo';
export const ANNOTATION_COMMIT = 'wololo.dev/commit';
export const ANNOTATION_ASSET_PATH = 'wololo.dev/asset-path';
/** The file whose contents the detail page renders as the asset body. */
export const ANNOTATION_BODY_PATH = 'wololo.dev/body-path';
export const ANNOTATION_APM_PACKAGE = 'wololo.dev/apm-package';

/**
 * Harness slugs the install panel can name, in display order. These are APM's
 * canonical `--target` slugs, so any slug a package declares in its own
 * `targets:` has a label here, and a repository manifest may name any of them.
 * The ones flagged `standalone` are the ones a standalone asset, which installs
 * through ainb and not APM, can be offered, and the default when a manifest
 * names none.
 */
export const HARNESSES = [
  { id: 'claude', label: 'Claude Code', standalone: true },
  { id: 'copilot', label: 'GitHub Copilot', standalone: true },
  { id: 'codex', label: 'Codex', standalone: true },
  { id: 'cursor', label: 'Cursor' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'kiro', label: 'Kiro' },
  { id: 'grok-build', label: 'Grok Build' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'hermes', label: 'Hermes' },
  { id: 'agent-skills', label: 'Agent Skills' },
] as const;

/**
 * The APM release the list above was taken from. A pack may declare a target
 * newer than this, so the hub's list is not proof that a target is wrong, only
 * that the hub has not been taught it. A test pins the list to this version.
 */
export const APM_TARGETS_VERSION = '0.33.0';

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

/**
 * Why there is no install command: `refused` APM would not read the pack's
 * manifest, `narrowed` the repository's own harnesses list leaves out every
 * target the pack declares, `unknown-target` the pack declares only targets
 * this hub has not been taught, `path` the path would not survive a shell.
 */
export type InstallUnavailable =
  | 'refused'
  | 'narrowed'
  | 'unknown-target'
  | 'path';

export function readInstallUnavailable(
  entity: Entity,
): InstallUnavailable | undefined {
  const value = annotation(entity, ANNOTATION_INSTALL_UNAVAILABLE);
  return value === 'refused' ||
    value === 'narrowed' ||
    value === 'unknown-target' ||
    value === 'path'
    ? value
    : undefined;
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
