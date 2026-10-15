import { parse as parseYaml } from 'yaml';
import { HARNESSES } from '@internal/plugin-skill-hub-common';

/** The file a repository declares itself in: an APM package at its root. */
export const APM_FILE = 'apm.yml';

/** The legacy manifest. When a repository has one it takes precedence. */
export const LEGACY_MANIFEST_FILE = '.agent-assets.yaml';

/**
 * The asset kinds a repository can publish. These are the keys under
 * `publish:` in `.agent-assets.yaml`, and they map onto the entity model:
 * everything but `packages` and `mcp` becomes an AiResource with the matching
 * `spec.type`.
 */
export const ASSET_KINDS = [
  'skills',
  'rules',
  'agents',
  'hooks',
  'prompts',
  'evals',
  'packages',
  'mcp',
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

/** The `spec.type` each publish key produces. */
export const SPEC_TYPE_BY_KIND: Record<
  Exclude<AssetKind, 'packages' | 'mcp'>,
  string
> = {
  skills: 'skill',
  rules: 'rule',
  agents: 'agent',
  hooks: 'hook',
  prompts: 'prompt',
  evals: 'eval-suite',
};

export interface AgentAssetsManifest {
  /** The file this came from, which entities point back to as their origin. */
  source: typeof APM_FILE | typeof LEGACY_MANIFEST_FILE;
  /** Entity reference for the owner of everything the repository publishes. */
  owner: string;
  /** Optional system every asset belongs to, unless a pack claims it first. */
  system?: string;
  /** Harnesses these assets target. Defaults to the three ainb installs to. */
  harnesses: string[];
  /**
   * Whether the repository wrote `harnesses:` itself. A written list is a
   * limit on everything the repository publishes; an omitted one is only the
   * default for standalone assets and does not limit what a pack declares.
   */
  harnessesExplicit: boolean;
  /** Glob patterns per asset kind, relative to the repository root. */
  publish: Partial<Record<AssetKind, string[]>>;
}

/**
 * Thrown when a manifest is present but cannot be honoured. The provider
 * catches this, records it against the repository and carries on: one bad
 * manifest never stops a sync.
 */
export class ManifestError extends Error {}

const KNOWN_HARNESSES: string[] = HARNESSES.map(h => h.id);
/** What a standalone asset installs to when the manifest names nothing. */
export const STANDALONE_HARNESSES: string[] = HARNESSES.filter(
  h => 'standalone' in h && h.standalone,
).map(h => h.id);

function asStringArray(value: unknown, field: string): string[] {
  if (typeof value === 'string') return [value];
  if (
    Array.isArray(value) &&
    value.every((v): v is string => typeof v === 'string')
  ) {
    return value;
  }
  throw new ManifestError(
    `${field} must be a string or a list of strings, got ${JSON.stringify(
      value,
    )}`,
  );
}

/**
 * Parses and validates `.agent-assets.yaml`.
 *
 * Validation is deliberately strict about the things the catalogue cannot
 * guess (an owner, at least one publish glob) and lenient about everything
 * else, so a repository is never silently half-published.
 */
export function parseManifest(raw: string): AgentAssetsManifest {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (error) {
    throw new ManifestError(`not valid YAML: ${(error as Error).message}`);
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ManifestError('must be a YAML mapping at the top level');
  }
  const root = doc as Record<string, unknown>;

  if (typeof root.owner !== 'string' || root.owner.trim() === '') {
    throw new ManifestError('owner is required and must be a string');
  }
  if (root.system !== undefined && typeof root.system !== 'string') {
    throw new ManifestError('system must be a string when set');
  }

  const harnesses = root.harnesses
    ? asStringArray(root.harnesses, 'harnesses')
    : STANDALONE_HARNESSES;
  const unknown = harnesses.filter(h => !KNOWN_HARNESSES.includes(h));
  if (unknown.length) {
    throw new ManifestError(
      `unknown harness ${unknown.join(', ')}, expected one of ${KNOWN_HARNESSES.join(
        ', ',
      )}`,
    );
  }

  if (
    root.publish === null ||
    typeof root.publish !== 'object' ||
    Array.isArray(root.publish)
  ) {
    throw new ManifestError('publish is required and must be a mapping');
  }
  const publishRaw = root.publish as Record<string, unknown>;

  const unknownKinds = Object.keys(publishRaw).filter(
    k => !(ASSET_KINDS as readonly string[]).includes(k),
  );
  if (unknownKinds.length) {
    throw new ManifestError(
      `unknown publish key ${unknownKinds.join(
        ', ',
      )}, expected one of ${ASSET_KINDS.join(', ')}`,
    );
  }

  const publish: Partial<Record<AssetKind, string[]>> = {};
  for (const kind of ASSET_KINDS) {
    if (publishRaw[kind] === undefined) continue;
    publish[kind] = asStringArray(publishRaw[kind], `publish.${kind}`);
  }
  if (Object.keys(publish).length === 0) {
    throw new ManifestError('publish must name at least one asset kind');
  }

  return {
    source: LEGACY_MANIFEST_FILE,
    owner: root.owner,
    system: root.system,
    harnesses,
    harnessesExplicit: Boolean(root.harnesses),
    publish,
  };
}

/**
 * What a repository publishes when all it has is a root `apm.yml`: the package
 * itself and the primitives APM keeps under `.apm/`. The owner is the GitHub
 * account the repository lives under, because `apm.yml` has no field that is
 * an entity reference: a Group for an organisation and a User for a personal
 * account, since a Group named after a person does not exist. Nothing is
 * parsed here: a malformed `apm.yml` is reported by the pack reader as a
 * refused pack, with its members.
 */
export function manifestFromApm(
  githubOwner: string,
  ownerKind: 'User' | 'Organization' = 'Organization',
): AgentAssetsManifest {
  const kind = ownerKind === 'User' ? 'user' : 'group';
  return {
    source: APM_FILE,
    owner: `${kind}:default/${githubOwner.toLowerCase()}`,
    harnesses: STANDALONE_HARNESSES,
    harnessesExplicit: false,
    publish: {
      packages: [APM_FILE],
      skills: ['.apm/skills/*/SKILL.md'],
      agents: ['.apm/agents/*.agent.md'],
      rules: ['.apm/instructions/*.instructions.md'],
      prompts: ['.apm/prompts/*.prompt.md'],
    },
  };
}
