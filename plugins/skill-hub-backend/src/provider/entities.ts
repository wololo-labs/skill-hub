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
  APM_ALL_TARGETS,
  EvalScore,
  HARNESSES,
  InstallCommands,
} from '@internal/plugin-skill-hub-common';
import { RepoRef, TreeEntry } from '../github/GithubAssetReader';
import {
  AgentAssetsManifest,
  AssetKind,
  SPEC_TYPE_BY_KIND,
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
}

interface PackageInfo {
  /** Directory holding apm.yml, relative to the repository root. */
  dir: string;
  name: string;
  version?: string;
  score?: EvalScore;
  /** The harnesses APM will actually deploy this package to. */
  harnesses: string[];
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
  fallback: string[],
): string[] {
  const raw = apm.targets ?? apm.target;
  const declared = (Array.isArray(raw) ? raw : [raw]).filter(
    (t): t is string => typeof t === 'string',
  );
  if (!declared.length) return fallback;

  const known = new Set<string>(HARNESSES.map(h => h.id));
  const wanted = declared.flatMap(t => (t === 'all' ? APM_ALL_TARGETS : [t]));
  return HARNESSES.map(h => h.id).filter(
    id => wanted.includes(id) && known.has(id),
  );
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

  const base = (
    path: string,
    kind: 'blob' | 'tree',
    bodyPath?: string,
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
    try {
      apm = (parseYaml(await read(path)) ?? {}) as Record<string, unknown>;
    } catch {
      continue;
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

    const info: PackageInfo = {
      dir,
      name: entityName(name),
      version: typeof apm.version === 'string' ? apm.version : undefined,
      score,
      harnesses: packageHarnesses(apm, manifest.harnesses),
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
            ...base(path, 'blob', path, info.harnesses),
            ...(score
              ? { [ANNOTATION_EVAL_SCORE]: JSON.stringify(score) }
              : {}),
            [ANNOTATION_EVAL_SCORE_REF]: `system:${namespace}/${info.name}`,
            [ANNOTATION_INSTALL]: JSON.stringify(
              installCommands(repo, commitSha, info.harnesses, {
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
    const harnesses = pkg?.harnesses ?? manifest.harnesses;
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
              pkg
                ? { kind: 'package', dir: pkg.dir }
                : { kind: 'unit', path },
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
      const harnesses = pkg?.harnesses ?? manifest.harnesses;

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
                pkg
                  ? { kind: 'package', dir: pkg.dir }
                  : { kind: 'unit', path: assetPath },
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

  return { entities: [...byRef.values()], counts, collisions };
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
