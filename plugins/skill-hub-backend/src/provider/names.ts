/**
 * Backstage entity names allow letters, digits, and `-_.`, up to 63
 * characters. Asset names come from directory and file names, which mostly
 * already fit, so this only has to be a safety net.
 */
export function entityName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return (cleaned || 'unnamed').slice(0, 63).replace(/[-_.]+$/g, '');
}

/** One namespace per repository, so two repos may publish the same name. */
export function repoNamespace(owner: string, repo: string): string {
  return entityName(`${owner}-${repo}`);
}

/**
 * Fully qualifies an owner reference from the manifest. A bare `platform-team`
 * means `group:default/platform-team`: without the namespace it would resolve
 * inside the repository's own namespace, where no group exists.
 */
export function ownerRef(raw: string): string {
  const trimmed = raw.trim();
  const [kindPart, rest] = trimmed.includes(':')
    ? [trimmed.slice(0, trimmed.indexOf(':')), trimmed.slice(trimmed.indexOf(':') + 1)]
    : ['group', trimmed];
  const name = rest.includes('/') ? rest : `default/${rest}`;
  return `${kindPart.toLowerCase()}:${name}`;
}
