import { Entity } from '@backstage/catalog-model';
import { minimatch } from 'minimatch';
import { parse as parseYaml, parseAllDocuments } from 'yaml';
import {
  ANNOTATION_APM_PACKAGE,
  ANNOTATION_ASSET_PATH,
  ANNOTATION_BODY_PATH,
  ANNOTATION_COMMIT,
  ANNOTATION_EVAL_SCORE,
  ANNOTATION_EVAL_SCORE_REF,
  ANNOTATION_HARNESSES,
  ANNOTATION_INSTALL,
  ANNOTATION_REPO,
  ANNOTATION_SOURCE_LOCATION,
  EvalScore,
  HARNESSES,
  InstallCommands,
} from '@internal/plugin-skill-hub-common';
import { RepoRef, TreeEntry } from '../github/GithubAssetReader';
import {
  AgentAssetsManifest,
  AssetKind,
  SPEC_TYPE_BY_KIND,
  STANDALONE_HARNESSES,
} from './manifest';
import { describeMarkdown, describePython } from './describe';
import { entityName, ownerRef, repoNamespace } from './names';

export interface BuildInput {
  repo: RepoRef;
  commitSha: string;
  manifest: AgentAssetsManifest;
  tree: TreeEntry[];
  /** Reads a blob by path at the pinned commit. */
  read: (path: string) => Promise<string>;
}

export interface BuildResult {
  entities: Entity[];
  /** Asset counts per publish key, for the provider status report. */
  counts: Partial<Record<AssetKind, number>>;
  /** Entity references a second glob tried to claim, and lost. */
  collisions: string[];
  /** Things the owner should fix that did not stop the repository publishing. */
  warnings: string[];
}

interface PackageInfo {
  /** Directory holding apm.yml, relative to the repository root. */
  dir: string;
  name: string;
  version?: string;
  score?: EvalScore;
  /** The harnesses APM will actually deploy this package to. */
  harnesses: string[];
  /** APM would refuse to read this pack at all, so nothing in it installs. */
  refused: boolean;
  mcp: Array<Record<string, unknown>>;
}

const dirname = (path: string) => path.split('/').slice(0, -1).join('/');
const basename = (path: string) => path.split('/').pop() ?? path;
const stem = (path: string) => basename(path).replace(/\.[^.]+$/, '');

function matches(path: string, globs: string[]): boolean {
  return globs.some(g => minimatch(path, g, { dot: true }));
}

function sourceUrl(
  repo: RepoRef,
  commitSha: string,
  path: string,
  kind: 'blob' | 'tree',
): string {
  const suffix = kind === 'tree' ? '/' : '';
  const at = path ? `/${path}${suffix}` : '';
  return `https://github.com/${repo.owner}/${repo.repo}/${kind}/${commitSha}${at}`;
}

/**
 * A path, owner or repository name safe to put inside a command a person is
 * about to paste into a shell.
 *
 * GitHub already constrains owner and repository names, but a path comes from
 * a repository's own tree and may contain quotes, semicolons or backticks. An
 * install command is copied and run by hand, so a path that could break out of
 * its quoting is not escaped and offered anyway: the asset simply publishes no
 * command, and stays browsable and readable.
 */
const SHELL_SAFE = /^[A-Za-z0-9._][A-Za-z0-9._\-\/]*$/;

function shellSafe(...parts: string[]): boolean {
  return parts.every(
    part =>
      SHELL_SAFE.test(part) &&
      !part.split('/').includes('..') &&
      part.length <= 512,
  );
}

/**
 * The install gesture, as a copyable command per harness.
 *
 * An asset that lives inside an APM package installs as that package, because
 * that is the unit APM understands and the unit the pack was scored as. A
 * standalone asset installs through ainb, which addresses a single unit inside
 * a repository at a commit.
 */
function installCommands(
  repo: RepoRef,
  commitSha: string,
  harnesses: string[],
  target: { kind: 'package'; dir: string } | { kind: 'unit'; path: string },
): InstallCommands {
  const subject = target.kind === 'package' ? target.dir : target.path;
  if (!shellSafe(repo.owner, repo.repo, subject) || !/^[0-9a-f]{40}$/.test(commitSha)) {
    return {};
  }

  const commands: Record<string, string> = {};
  for (const harness of harnesses) {
    commands[harness] =
      target.kind === 'package'
        ? `apm install '${repo.owner}/${repo.repo}/${target.dir}#${commitSha}' --target ${harness}`
        : [
            `ainb source add gh:${repo.owner}/${repo.repo}`,
            `ainb skill install 'gh:${repo.owner}/${repo.repo}@${commitSha}/${target.path}' --targets ${harness} --yes`,
          ].join('\n');
  }
  return commands as InstallCommands;
}

/**
 * The gate's own report, as `wololo-evals-cli gate -o` wrote it.
 *
 * Nothing here is restated by hand: the verdict is the gate's verdict, every
 * metric is a signal's two means, and the commit is the commit the gate says
 * it measured. A number in the hub therefore cannot drift from the run that
 * produced it without the report itself being edited.
 *
 * A report that names no commit still scores the asset. It just cannot show
 * staleness, which is the publisher's omission to fix and not a reason to
 * drop the score.
 */
function readGateReport(reportJson: string): EvalScore | undefined {
  let report: {
    verdict?: unknown;
    recorded?: unknown;
    source?: unknown;
    sourceVisibility?: unknown;
    subject?: { commit?: unknown } | null;
    signals?: unknown;
  };
  try {
    report = JSON.parse(reportJson);
  } catch {
    return undefined;
  }
  if (typeof report !== 'object' || report === null) return undefined;
  if (typeof report.verdict !== 'string') return undefined;

  const signals = Array.isArray(report.signals) ? report.signals : [];
  const scored = signals.filter(
    (s): s is { evaluator_id: string; candidate_mean: number; baseline_mean: number; guarded?: boolean } =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as any).evaluator_id === 'string' &&
      typeof (s as any).candidate_mean === 'number' &&
      typeof (s as any).baseline_mean === 'number',
  );
  // The signals the gate was told to guard come first, so the headline metric
  // on the badge is one the gate would have failed on rather than whichever
  // evaluator happened to be emitted first.
  const ordered = [
    ...scored.filter(s => s.guarded),
    ...scored.filter(s => !s.guarded),
  ];
  const metrics = Object.fromEntries(
    ordered.map(s => [
      s.evaluator_id,
      { candidate: s.candidate_mean, baseline: s.baseline_mean },
    ]),
  );

  const text = (value: unknown) =>
    typeof value === 'string' && value ? value : undefined;
  const commit = text(report.subject?.commit);

  return {
    // `pass` is the only verdict that opens the install gate, and every other
    // one the gate can return (`regression`, `refused`) is carried through as
    // itself rather than flattened to a failure it might not be.
    verdict: report.verdict.toUpperCase(),
    recorded: text(report.recorded),
    source: text(report.source),
    sourceVisibility: text(report.sourceVisibility),
    ...(Object.keys(metrics).length ? { metrics } : {}),
    ...(commit && /^[0-9a-f]{7,40}$/.test(commit)
      ? { measuredCommit: commit }
      : {}),
  };
}

/**
 * Reads the score a publisher has already recorded.
 *
 * The gate's own report is preferred over everything else, because it is the
 * only form the publisher did not have to transcribe. A generated
 * `catalog-info.yaml` comes next, then a bare `eval-score.json`.
 */
function readPackageScore(
  gateReport: string | undefined,
  catalogInfo: string | undefined,
  evalScoreJson: string | undefined,
): EvalScore | undefined {
  if (gateReport) {
    const score = readGateReport(gateReport);
    if (score) return score;
  }
  if (catalogInfo) {
    try {
      for (const doc of parseAllDocuments(catalogInfo)) {
        const entity = doc.toJS() as Entity | null;
        const raw = entity?.metadata?.annotations?.[ANNOTATION_EVAL_SCORE];
        if (!raw) continue;
        const score = JSON.parse(raw) as EvalScore;
        const location =
          entity?.metadata?.annotations?.[ANNOTATION_SOURCE_LOCATION];
        const measured = /\/(?:tree|blob)\/([0-9a-f]{7,40})\//.exec(
          location ?? '',
        )?.[1];
        return measured ? { ...score, measuredCommit: measured } : score;
      }
    } catch {
      // Fall through to eval-score.json rather than dropping the score.
    }
  }
  if (evalScoreJson) {
    try {
      const parsed = JSON.parse(evalScoreJson) as EvalScore & {
        commit?: string;
      };
      return parsed.commit
        ? { ...parsed, measuredCommit: parsed.commit }
        : parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The harnesses a package can be installed for.
 *
 * APM treats a package's own `targets:` as a restriction, not a default:
 * `apm install --target codex` on a pack that declares `[claude, copilot]`
 * skips every primitive in it, exits 0 and still reports the dependency
 * installed. Offering a target the pack excludes would hand over a command
 * that succeeds and delivers nothing, so the declared targets decide what is
 * offered. A pack that declares none falls back to what the repository's
 * manifest names, and a declaration naming only slugs APM does not know
 * offers nothing rather than guessing.
 */
function packageHarnesses(
  apm: Record<string, unknown>,
  manifest: AgentAssetsManifest,
  dir: string,
  refusal?: string,
): { harnesses: string[]; warnings: string[]; refused: boolean } {
  const { tokens, error: declarationError } = declaredTargets(apm);
  const error = refusal ?? declarationError;
  const where = dir || '(repository root)';
  if (error) {
    // APM refuses to read a manifest like this, so the pack cannot be
    // installed whatever the hub offers. Falling back to the repository's
    // harnesses would hand over a command that fails.
    return {
      harnesses: [],
      refused: true,
      warnings: [
        `${where}: apm.yml ${error}, so no install command is offered`,
      ],
    };
  }
  if (!tokens) {
    return { harnesses: manifest.harnesses, warnings: [], refused: false };
  }

  const known = HARNESSES.map(h => h.id) as string[];
  const unknown = tokens.filter(t => !known.includes(t));
  // A repository that wrote its own harnesses has limited what it supports,
  // so a pack declaring more does not widen that. One that left it out has
  // only taken the default, which is not a limit on a pack.
  const allowed = manifest.harnessesExplicit ? manifest.harnesses : known;
  const harnesses = known.filter(
    id => tokens.includes(id) && allowed.includes(id),
  );
  const warnings = unknown.length
    ? [
        `${where}: apm.yml declares targets this hub does not know (${unknown.join(
          ', ',
        )}), so they are not offered`,
      ]
    : [];
  // A pack nobody can install is a problem with the pack or the repository's
  // harnesses, and it should be reported rather than shown as an empty list.
  if (!harnesses.length) {
    warnings.push(
      `${where}: apm.yml declares ${tokens.join(
        ', ',
      )}, none of which can be offered here, so no install command is offered`,
    );
  }
  return { harnesses, warnings, refused: false };
}

/**
 * The spellings APM accepts in an apm.yml target field that are not a
 * canonical slug. Only `vscode` is one: `agents` and `agy` are accepted on the
 * command line but rejected in a manifest.
 */
const MANIFEST_TARGET_ALIASES: Record<string, string> = { vscode: 'copilot' };

/**
 * The targets a package declares, read the way APM reads them
 * (`apm_cli/core/apm_yml.py`, the same in 0.29.0 and 0.33.0). `tokens` is
 * undefined when it declares none and so restricts nothing; `error` is set
 * when APM would refuse the manifest outright.
 *
 * Under `targets` a lone value is one target, and an empty or missing value is
 * an error. Under the singular `target` a string may be comma separated and an
 * empty value means nothing declared. Tokens are trimmed and compared
 * exactly: APM is case sensitive, so a spelling it would reject is not
 * normalised into one it would accept. `all` folds to no restriction, which is
 * what omitting the field means.
 */
function declaredTargets(apm: Record<string, unknown>): {
  tokens?: string[];
  error?: string;
} {
  const hasTargets = 'targets' in apm;
  const hasTarget = 'target' in apm;
  if (hasTargets && hasTarget)
    return { error: 'declares both targets and target' };
  if (!hasTargets && !hasTarget) return {};

  const key = hasTargets ? 'targets' : 'target';
  const raw = apm[key];
  let tokens: string[];
  if (Array.isArray(raw)) {
    tokens = raw.map(String);
  } else if (raw === null || raw === undefined) {
    tokens = [];
  } else if (typeof raw === 'object') {
    return { error: `${key} must be a list or a single target` };
  } else {
    tokens = hasTargets ? [String(raw)] : String(raw).split(',');
  }
  tokens = tokens.map(t => t.trim()).filter(Boolean);

  if (!tokens.length) {
    return hasTargets ? { error: 'has an empty targets list' } : {};
  }
  if (tokens.includes('all')) return {};
  return { tokens: tokens.map(t => MANIFEST_TARGET_ALIASES[t] ?? t) };
}

/**
 * Every path the manifest asks for, plus the sidecars a package needs. The
 * provider uses this to warm the blob cache concurrently, so building the
 * entities is not several hundred sequential round trips.
 */
export function publishedPaths(
  manifest: AgentAssetsManifest,
  files: string[],
): string[] {
  const globs = Object.values(manifest.publish).flat();
  const matched = files.filter(path => matches(path, globs));
  const sidecars = matched
    .filter(path => matches(path, manifest.publish.packages ?? []))
    .flatMap(path => [
      `${dirname(path)}/eval-gate-report.json`,
      `${dirname(path)}/catalog-info.yaml`,
      `${dirname(path)}/eval-score.json`,
      `${dirname(path)}/README.md`,
    ])
    .filter(path => files.includes(path));
  return [...new Set([...matched, ...sidecars])];
}

export async function buildEntities(input: BuildInput): Promise<BuildResult> {
  const { repo, commitSha, manifest, tree, read } = input;
  const namespace = repoNamespace(repo.owner, repo.repo);
  const owner = ownerRef(manifest.owner);
  const files = tree.filter(e => e.type === 'blob').map(e => e.path);
  const paths = new Set(files);

  const counts: Partial<Record<AssetKind, number>> = {};
  const collisions: string[] = [];
  const warnings: string[] = [];

  // Two globs can name the same asset twice, most obviously when a repository
  // publishes both a pack and the files inside it. First match wins and the
  // rest are reported, because silently dropping half a repository is worse
  // than a duplicate the owner can see and fix.
  const byRef = new Map<string, Entity>();
  const entities = {
    push(...added: Entity[]) {
      for (const entity of added) {
        const ref = `${entity.kind}:${entity.metadata.namespace}/${entity.metadata.name}`;
        if (byRef.has(ref)) {
          collisions.push(ref);
          continue;
        }
        byRef.set(ref, entity);
      }
    },
  };

  // A pack's own targets restrict its primitives but not an MCP server it
  // depends on: `apm install --target codex` on a pack declaring
  // [claude, copilot] skips the pack and still writes the server to
  // .codex/config.toml (docs/INSTALL-PROOF.md, APM 0.29.0 and 0.33.0). Only
  // codex is evidenced, so only codex is added, and only where the repository
  // has not narrowed it away. A pack APM refuses to read offers nothing. It
  // covers servers declared under dependencies.mcp only, not a file the
  // repository publishes from inside the pack.
  const MCP_DEPLOYED_DESPITE_TARGETS = ['codex'];
  const mcpHarnessesOf = (pkg: PackageInfo): string[] => {
    // A pack narrowed to nothing is still read by APM, and its servers still
    // deploy; only one APM refuses to read offers nothing.
    if (pkg.refused) return [];
    const allowed = manifest.harnessesExplicit
      ? manifest.harnesses
      : MCP_DEPLOYED_DESPITE_TARGETS;
    return HARNESSES.map(h => h.id as string).filter(
      id =>
        pkg.harnesses.includes(id) ||
        (MCP_DEPLOYED_DESPITE_TARGETS.includes(id) && allowed.includes(id)),
    );
  };

  const base = (
    path: string,
    kind: 'blob' | 'tree',
    bodyPath: string | undefined,
    harnesses: string[],
  ) => ({
    [ANNOTATION_SOURCE_LOCATION]: `url:${sourceUrl(repo, commitSha, path, kind)}`,
    'backstage.io/managed-by-location': `url:${sourceUrl(repo, commitSha, '.agent-assets.yaml', 'blob')}`,
    'backstage.io/managed-by-origin-location': `url:${sourceUrl(repo, commitSha, '.agent-assets.yaml', 'blob')}`,
    [ANNOTATION_REPO]: `${repo.owner}/${repo.repo}`,
    [ANNOTATION_COMMIT]: commitSha,
    [ANNOTATION_ASSET_PATH]: path,
    ...(bodyPath ? { [ANNOTATION_BODY_PATH]: bodyPath } : {}),
    [ANNOTATION_HARNESSES]: harnesses.join(','),
  });

  const sourceLink = (path: string, kind: 'blob' | 'tree') => [
    { url: sourceUrl(repo, commitSha, path, kind), title: 'Source', type: 'source' },
  ];

  // Packages first: an asset that sits inside one inherits its system, its
  // score and its install command.
  const packages: PackageInfo[] = [];
  for (const path of files) {
    if (!matches(path, manifest.publish.packages ?? [])) continue;
    const dir = dirname(path);
    let apm: Record<string, unknown>;
    // Why APM would refuse to read this pack at all, when it would.
    let refusal: string | undefined;
    try {
      const parsed = parseYaml(await read(path)) ?? {};
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        apm = parsed as Record<string, unknown>;
      } else {
        apm = {};
        refusal = 'is not a YAML mapping';
      }
    } catch {
      // Not the pack's own fault to be silent about: its members would
      // otherwise look standalone and install everywhere.
      apm = {};
      refusal = 'could not be parsed as YAML';
    }
    const name = typeof apm.name === 'string' ? apm.name : stem(dir || path);
    const score = readPackageScore(
      paths.has(`${dir}/eval-gate-report.json`)
        ? await read(`${dir}/eval-gate-report.json`)
        : undefined,
      paths.has(`${dir}/catalog-info.yaml`)
        ? await read(`${dir}/catalog-info.yaml`)
        : undefined,
      paths.has(`${dir}/eval-score.json`)
        ? await read(`${dir}/eval-score.json`)
        : undefined,
    );
    const deps = apm.dependencies as { mcp?: unknown } | undefined;
    const mcp = Array.isArray(deps?.mcp)
      ? (deps.mcp.filter(
          (m): m is Record<string, unknown> =>
            typeof m === 'object' && m !== null,
        ) as Array<Record<string, unknown>>)
      : [];

    const declared = packageHarnesses(apm, manifest, dir, refusal);
    warnings.push(...declared.warnings);
    const info: PackageInfo = {
      dir,
      name: entityName(name),
      version: typeof apm.version === 'string' ? apm.version : undefined,
      score,
      harnesses: declared.harnesses,
      refused: declared.refused,
      mcp,
    };
    packages.push(info);
    counts.packages = (counts.packages ?? 0) + 1;

    const tags = Array.isArray(apm.keywords)
      ? apm.keywords.filter((k): k is string => typeof k === 'string')
      : undefined;

    entities.push({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'System',
      metadata: {
        name: info.name,
        namespace,
        title: info.version ? `${name} ${info.version}` : name,
        description:
          typeof apm.description === 'string' ? apm.description : undefined,
        tags,
        annotations: {
          ...base(
            dir,
            'tree',
            paths.has(`${dir}/README.md`) ? `${dir}/README.md` : path,
            info.harnesses,
          ),
          ...(info.version
            ? { [ANNOTATION_APM_PACKAGE]: `${name}@${info.version}` }
            : {}),
          ...(score ? { [ANNOTATION_EVAL_SCORE]: JSON.stringify(score) } : {}),
          [ANNOTATION_INSTALL]: JSON.stringify(
            installCommands(repo, commitSha, info.harnesses, {
              kind: 'package',
              dir,
            }),
          ),
        },
        links: sourceLink(dir, 'tree'),
      },
      spec: { owner },
    });

    // MCP servers declared by the pack. They are part of what installing the
    // pack gives you, so they carry the pack's score and command.
    for (const server of info.mcp) {
      const serverName =
        typeof server.name === 'string' ? server.name : undefined;
      if (!serverName) continue;
      entities.push({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'API',
        metadata: {
          name: entityName(serverName),
          namespace,
          title: `${serverName} MCP server`,
          description: `MCP server declared as a dependency of ${name} (${
            typeof server.transport === 'string' ? server.transport : 'stdio'
          } transport).`,
          tags,
          annotations: {
            ...base(path, 'blob', path, mcpHarnessesOf(info)),
            ...(score
              ? { [ANNOTATION_EVAL_SCORE]: JSON.stringify(score) }
              : {}),
            [ANNOTATION_EVAL_SCORE_REF]: `system:${namespace}/${info.name}`,
            [ANNOTATION_INSTALL]: JSON.stringify(
              installCommands(repo, commitSha, mcpHarnessesOf(info), {
                kind: 'package',
                dir,
              }),
            ),
          },
          links: sourceLink(path, 'blob'),
        },
        spec: {
          type: 'mcp-server',
          lifecycle: 'experimental',
          owner,
          system: info.name,
          definition: JSON.stringify(server, null, 2),
          ...(typeof server.command === 'string'
            ? {
                remotes: [
                  {
                    type:
                      typeof server.transport === 'string'
                        ? server.transport
                        : 'stdio',
                    url: [
                      server.command,
                      ...(Array.isArray(server.args) ? server.args : []),
                    ].join(' '),
                  },
                ],
              }
            : {}),
        },
      });
      counts.mcp = (counts.mcp ?? 0) + 1;
    }
  }

  /**
   * The system an asset belongs to: the pack that contains it if there is one,
   * otherwise whatever the manifest declared, otherwise nothing.
   */
  const systemOf = (pkg: PackageInfo | undefined) => {
    const system = pkg?.name ?? manifest.system;
    return system ? { system } : {};
  };

  // An asset inside a pack installs as that pack, so it is offered what the
  // pack is; a standalone asset takes the repository manifest's harnesses and
  // installs as itself. One place decides both, so the two cannot drift.
  const harnessesOf = (pkg: PackageInfo | undefined): string[] =>
    pkg
      ? pkg.harnesses
      : manifest.harnesses.filter(h => STANDALONE_HARNESSES.includes(h));
  const installTarget = (pkg: PackageInfo | undefined, path: string) =>
    pkg
      ? ({ kind: 'package', dir: pkg.dir } as const)
      : ({ kind: 'unit', path } as const);

  const owningPackage = (path: string): PackageInfo | undefined =>
    packages
      .filter(p => p.dir === '' || path.startsWith(`${p.dir}/`))
      .sort((a, b) => b.dir.length - a.dir.length)[0];

  // Standalone MCP server descriptors.
  for (const path of files) {
    if (!matches(path, manifest.publish.mcp ?? [])) continue;
    let server: Record<string, unknown>;
    try {
      server = JSON.parse(await read(path)) as Record<string, unknown>;
    } catch {
      continue;
    }
    const pkg = owningPackage(path);
    const harnesses = harnessesOf(pkg);
    const name = typeof server.name === 'string' ? server.name : stem(path);
    entities.push({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'API',
      metadata: {
        name: entityName(name),
        namespace,
        title: `${name} MCP server`,
        description:
          typeof server.description === 'string'
            ? server.description
            : `MCP server declared in ${path}.`,
        annotations: {
          ...base(path, 'blob', path, harnesses),
          ...scoreAnnotations(pkg, namespace),
          [ANNOTATION_INSTALL]: JSON.stringify(
            installCommands(
              repo,
              commitSha,
              harnesses,
              installTarget(pkg, path),
            ),
          ),
        },
        links: sourceLink(path, 'blob'),
      },
      spec: {
        type: 'mcp-server',
        lifecycle: 'experimental',
        owner,
        ...systemOf(pkg),
        definition: JSON.stringify(server, null, 2),
      },
    });
    counts.mcp = (counts.mcp ?? 0) + 1;
  }

  // Everything else is an AiResource with the spec type its publish key maps
  // to. A skill is addressed by its directory, because a skill is a directory
  // of files; every other kind is a single file.
  for (const kind of Object.keys(SPEC_TYPE_BY_KIND) as Array<
    keyof typeof SPEC_TYPE_BY_KIND
  >) {
    const globs = manifest.publish[kind];
    if (!globs?.length) continue;

    for (const path of files) {
      if (!matches(path, globs)) continue;

      const isDirectoryAsset = kind === 'skills' && /\/SKILL\.md$/i.test(path);
      const assetPath = isDirectoryAsset ? dirname(path) : path;
      const body = await read(path);
      const described = path.endsWith('.py')
        ? describePython(body)
        : describeMarkdown(body);

      const fallbackName = isDirectoryAsset
        ? basename(dirname(path))
        : stem(path).replace(/\.(agent|instructions|prompt|eval)$/, '');
      const name = entityName(described.name ?? fallbackName);
      const pkg = owningPackage(path);
      const harnesses = harnessesOf(pkg);

      entities.push({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'AiResource',
        metadata: {
          name,
          namespace,
          title: described.title,
          description: described.description,
          tags: described.tags,
          annotations: {
            ...base(assetPath, isDirectoryAsset ? 'tree' : 'blob', path, harnesses),
            ...scoreAnnotations(pkg, namespace),
            [ANNOTATION_INSTALL]: JSON.stringify(
              installCommands(
                repo,
                commitSha,
                harnesses,
                installTarget(pkg, assetPath),
              ),
            ),
          },
          links: sourceLink(assetPath, isDirectoryAsset ? 'tree' : 'blob'),
        },
        spec: {
          type: SPEC_TYPE_BY_KIND[kind],
          lifecycle: 'experimental',
          owner,
          ...systemOf(pkg),
          agents: harnesses,
        },
      });
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }

  return { entities: [...byRef.values()], counts, collisions, warnings };
}

function scoreAnnotations(
  pkg: PackageInfo | undefined,
  namespace: string,
): Record<string, string> {
  if (!pkg) return {};
  return {
    [ANNOTATION_EVAL_SCORE_REF]: `system:${namespace}/${pkg.name}`,
    // The score is copied onto the member rather than resolved live, so the
    // install gate is a local check. The measurement commit travels with it,
    // which is what makes a stale score visible next to the pinned commit.
    ...(pkg.score
      ? { [ANNOTATION_EVAL_SCORE]: JSON.stringify(pkg.score) }
      : {}),
  };
}
