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
  /** A number as the gate wrote it, or the text a hand-written score gave. */
  candidate: number | string;
  baseline: number | string;
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
   * Where the score came from. The provider sets it, and only a gate report
   * can show a gain: a hand-written file can say a pass, never an improvement.
   */
  origin?: ScoreOrigin;
  /**
   * The gate's aggregate statistics over every case. Absent when the report
   * carries none, which reads as no demonstrated gain, never as a gain.
   */
  stats?: EvalStats;
}

export type ScoreOrigin = 'gate-report' | 'eval-score' | 'catalogue';

const ORIGIN_WORDS: Record<ScoreOrigin, string> = {
  'gate-report': 'a gate report',
  'eval-score': 'an eval-score.json, not a gate run',
  catalogue: 'a catalogue file, not a gate run',
};

/** Where a score came from, in words, saying when it is not a gate run. */
export function describeOrigin(origin: ScoreOrigin | undefined): string {
  return origin ? ORIGIN_WORDS[origin] : 'an unknown source, not a gate run';
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
  // A pass the gate itself measured as significantly worse is a regression,
  // whatever the verdict string says.
  if (
    (score.verdict ?? '').toUpperCase() === 'REGRESSION' ||
    score.stats?.significantRegression === true
  ) {
    return 'regressed';
  }
  // The same definition of a pass the install gate uses, so the badge and the
  // button cannot disagree.
  if (!passedGate(score)) return 'failed';
  // Only a gate run can show an improvement over the model alone. A score from
  // anywhere else can say it passed, and is capped at no measured gain.
  return score.stats?.significantImprovement === true &&
    score.origin === 'gate-report'
    ? 'gain'
    : 'no-gain';
}

/**
 * Passed the gate's own threshold but measured significantly worse than the
 * model alone. The copy for it must say both, not that it failed to pass.
 */
export function isMeasuredWorse(score: EvalScore | undefined): boolean {
  return (
    (score?.verdict ?? '').toUpperCase() === 'PASS' &&
    score?.stats?.significantRegression === true
  );
}

/** The verdict as shown, or the plain fact that the report has none. */
export function describeVerdict(score: EvalScore): string {
  return score.verdict?.toUpperCase() ?? 'verdict missing';
}

/**
 * The change over the model alone with its interval, for the places that
 * spell it out. A missing mean is said to be unrecorded, never left blank.
 */
export function describeChange(
  stats: EvalStats | undefined,
): string | undefined {
  if (!stats) return undefined;
  const { meanDelta, ciLow, ciHigh } = stats;
  const hasInterval = ciLow !== undefined && ciHigh !== undefined;
  if (meanDelta === undefined && !hasInterval) return undefined;

  // Four places and a sign: three would show a significant +0.0004 as +0.000.
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(4)}`;
  const mean = meanDelta === undefined ? 'unrecorded' : signed(meanDelta);
  return hasInterval
    ? `${mean} (${ciLow.toFixed(4)} to ${ciHigh.toFixed(4)})`
    : mean;
}

/** A commit as git abbreviates one: 7 to 40 hex digits, lower cased. */
const SHORTEST_COMMIT = 7;

/**
 * Whether the score was measured at a different commit from the one the asset
 * is pinned to. Unknown on either side is not stale: there is nothing to
 * compare, and the score is shown either way.
 */
export function isScoreStale(
  score: EvalScore | undefined,
  pinnedCommit: string | undefined,
): boolean {
  const measured = score?.measuredCommit?.toLowerCase();
  const pinned = pinnedCommit?.toLowerCase();
  // Nothing to compare against when either side is unknown, or the pinned
  // commit is too short to be one.
  if (!measured || !pinned || pinned.length < SHORTEST_COMMIT) return false;
  // Only a commit that is a full or prefix match of the pinned one is current.
  // A tag, a branch or a stub too short to identify a commit is not a match
  // and stays stale, shown as written.
  const isCommit = /^[0-9a-f]{7,40}$/.test(measured);
  return !isCommit || (!pinned.startsWith(measured) && !measured.startsWith(pinned));
}

/** Install command per harness, keyed by harness id. */
export type InstallCommands = Partial<Record<HarnessId, string>>;

function annotation(entity: Entity, key: string): string | undefined {
  const value = entity.metadata.annotations?.[key];
  return value === '' ? undefined : value;
}

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined;
const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const commitOf = (value: unknown): string | undefined => {
  const candidate = typeof value === 'number' ? String(value) : value;
  if (typeof candidate !== 'string' || !candidate.trim()) return undefined;
  const written = candidate.trim();
  // A sha is lower cased. Anything else (a tag, a branch) is kept as written,
  // because dropping it would make a score taken at v1.2.0 read as current.
  return /^[0-9a-f]{7,40}$/i.test(written) ? written.toLowerCase() : written;
};
const shown = (value: unknown) =>
  finite(value) ?? (typeof value === 'string' ? value : undefined);

/**
 * A score is read from an annotation that a publisher, a legacy
 * `eval-score.json` or a hand-written catalogue file may have filled with
 * anything. Every field is checked here, once, so no surface has to guard.
 * A value that is text where a number belongs is kept as text, which is
 * shown as it was written rather than crashing the list.
 */
function sanitizeScore(raw: Record<string, unknown>): EvalScore {
  const metrics: Record<string, EvalMetric> = {};
  if (typeof raw.metrics === 'object' && raw.metrics !== null) {
    for (const [name, m] of Object.entries(raw.metrics)) {
      const candidate = shown((m as any)?.candidate);
      const baseline = shown((m as any)?.baseline);
      if (candidate !== undefined && baseline !== undefined) {
        metrics[name] = { candidate, baseline };
      }
    }
  }
  // The gate writes snake_case and a hand-written or generated catalogue
  // carries it through, so both spellings are read, here and nowhere else.
  const s = ((typeof raw.stats === 'object' && raw.stats) || {}) as Record<
    string,
    unknown
  >;
  // The first spelling that holds a value of the right type, so a wrong-typed
  // camelCase value never hides a valid snake_case one.
  const first = <T>(
    parse: (value: unknown) => T | undefined,
    camel: string,
    snake: string,
  ): T | undefined => parse(s[camel]) ?? parse(s[snake]);
  const flag = (value: unknown) =>
    typeof value === 'boolean' ? value : undefined;
  const stats = Object.fromEntries(
    Object.entries({
      meanDelta: first(finite, 'meanDelta', 'mean_delta'),
      ciLow: first(finite, 'ciLow', 'ci_low'),
      ciHigh: first(finite, 'ciHigh', 'ci_high'),
      confidence: finite(s.confidence),
      significantImprovement: first(
        flag,
        'significantImprovement',
        'significant_improvement',
      ),
      significantRegression: first(
        flag,
        'significantRegression',
        'significant_regression',
      ),
    }).filter(([, v]) => v !== undefined),
  ) as EvalStats;
  const commit = commitOf(raw.measuredCommit);
  const origin = ['gate-report', 'eval-score', 'catalogue'].includes(
    raw.origin as string,
  )
    ? (raw.origin as ScoreOrigin)
    : undefined;
  return {
    verdict: text(raw.verdict),
    ...(origin ? { origin } : {}),
    recorded: text(raw.recorded),
    source: text(raw.source),
    sourceVisibility: text(raw.sourceVisibility),
    ...(Object.keys(metrics).length ? { metrics } : {}),
    ...(Object.keys(stats).length ? { stats } : {}),
    ...(commit ? { measuredCommit: commit } : {}),
  };
}

export function readEvalScore(entity: Entity): EvalScore | undefined {
  const raw = annotation(entity, ANNOTATION_EVAL_SCORE);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? sanitizeScore(parsed)
      : undefined;
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
 * anything other than PASS as a failed gate, and so does the install gate. A
 * pass the gate measured as significantly worse is not a pass either.
 */
export function passedGate(score: EvalScore | undefined): boolean {
  return (
    (score?.verdict ?? '').toUpperCase() === 'PASS' &&
    score?.stats?.significantRegression !== true
  );
}

/**
 * The install gate. An asset is installable only when an eval gate has been run
 * against it and passed. Unmeasured and failed are both blocked: a score that
 * says the asset does not work is not a reason to hand over the command.
 */
export function isInstallable(entity: Entity): boolean {
  return passedGate(readEvalScore(entity));
}
