import { parse as parseYaml } from 'yaml';

export interface AssetDescription {
  name?: string;
  title?: string;
  description?: string;
  tags?: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

/** YAML frontmatter, if the document opens with a fence. */
export function frontmatter(body: string): Record<string, unknown> | undefined {
  const match = FRONTMATTER.exec(body);
  if (!match) return undefined;
  try {
    const doc = parseYaml(match[1]);
    return doc && typeof doc === 'object' && !Array.isArray(doc)
      ? (doc as Record<string, unknown>)
      : undefined;
  } catch {
    // A skill whose frontmatter does not parse still has a body worth
    // publishing, so this falls through to the prose heuristics below.
    return undefined;
  }
}

function firstProse(body: string): string | undefined {
  const withoutFrontmatter = body.replace(FRONTMATTER, '');
  for (const line of withoutFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('<!--')) continue;
    if (trimmed.startsWith('```')) return undefined;
    return trimmed;
  }
  return undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const strings = value.filter((v): v is string => typeof v === 'string');
    return strings.length ? strings : undefined;
  }
  return undefined;
}

/** Describes a markdown asset from its frontmatter, falling back to prose. */
export function describeMarkdown(body: string): AssetDescription {
  const fm = frontmatter(body) ?? {};
  const heading = /^#\s+(.+)$/m.exec(body.replace(FRONTMATTER, ''))?.[1]?.trim();
  return {
    name: typeof fm.name === 'string' ? fm.name : undefined,
    title: typeof fm.title === 'string' ? fm.title : heading,
    description:
      typeof fm.description === 'string' ? fm.description : firstProse(body),
    tags: asStringList(fm.tags) ?? asStringList(fm.keywords),
  };
}

const PY_DOCSTRING = /^(?:#![^\n]*\n)?(?:\s*(?:#[^\n]*\n)*)?\s*(?:'''|""")([\s\S]*?)(?:'''|""")/;
const PY_COMMENT_BLOCK = /^(?:#![^\n]*\n)((?:\s*#[^\n]*\n)+)/;

/**
 * Describes a Python hook. Hooks carry no frontmatter, so the module docstring
 * is the description, and a leading comment block is the fallback.
 */
export function describePython(body: string): AssetDescription {
  const docstring = PY_DOCSTRING.exec(body)?.[1];
  if (docstring) {
    const lines = docstring
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length) {
      return { description: lines.join(' ').slice(0, 500) };
    }
  }
  const comments = PY_COMMENT_BLOCK.exec(body)?.[1];
  if (comments) {
    const text = comments
      .split(/\r?\n/)
      .map(l => l.trim().replace(/^#\s?/, ''))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (text) return { description: text.slice(0, 500) };
  }
  return {};
}
