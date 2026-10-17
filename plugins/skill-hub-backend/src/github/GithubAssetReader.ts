import { Octokit } from '@octokit/rest';
import { LoggerService } from '@backstage/backend-plugin-api';
import { APM_FILE, LEGACY_MANIFEST_FILE } from '../provider/manifest';

export interface RepoRef {
  owner: string;
  repo: string;
  defaultBranch: string;
  archived: boolean;
  /**
   * What kind of GitHub account `owner` is, which is also the kind of Backstage
   * entity that can own what the repository publishes. Unset is read as an
   * organisation.
   */
  ownerKind?: 'User' | 'Organization';
}

export interface TreeEntry {
  path: string;
  /** Blob sha, which is content addressed and therefore cacheable forever. */
  sha: string;
  type: 'blob' | 'tree' | 'commit';
}

/**
 * The file a repository declared itself in, as fetched, with the commit every
 * asset will be pinned to. `path` says which of the two files it was.
 */
export interface ManifestFetch {
  path: typeof LEGACY_MANIFEST_FILE | typeof APM_FILE;
  raw: string;
  commitSha: string;
}

interface CacheEntry<T> {
  etag: string;
  value: T;
}

const MAX_BLOB_CACHE_ENTRIES = 5000;

/**
 * Everything the provider needs from GitHub, and nothing else.
 *
 * Two caches keep a ten minute schedule cheap. Conditional requests carry an
 * etag, and GitHub does not charge a 304 against the rate limit, so a quiet
 * estate costs almost nothing to rescan. Blob bodies are cached by their sha,
 * which is content addressed, so an unchanged file is never fetched twice.
 */
export class GithubAssetReader {
  readonly #octokit: Octokit;
  readonly #logger: LoggerService;
  readonly #repoListCache = new Map<string, CacheEntry<RepoRef[]>>();
  readonly #manifestCache = new Map<string, CacheEntry<string>>();
  readonly #blobCache = new Map<string, string>();

  constructor(options: { octokit: Octokit; logger: LoggerService }) {
    this.#octokit = options.octokit;
    this.#logger = options.logger;
  }

  /**
   * Lists the repositories of an owner, which may be an organisation or a
   * user account. GitHub uses a different endpoint for each and gives no
   * cheap way to know which you have, so the org endpoint is tried first and
   * a 404 falls through to the user endpoint.
   */
  async listRepositories(owner: string): Promise<RepoRef[]> {
    const cached = this.#repoListCache.get(owner);
    const headers = cached ? { 'if-none-match': cached.etag } : undefined;

    for (const kind of ['orgs', 'users'] as const) {
      try {
        const pages = await this.#octokit.paginate.iterator(
          kind === 'orgs'
            ? this.#octokit.rest.repos.listForOrg
            : this.#octokit.rest.repos.listForUser,
          // The cast is unavoidable: the two endpoints take `org` and
          // `username` respectively and are otherwise identical.
          { [kind === 'orgs' ? 'org' : 'username']: owner, per_page: 100, headers } as any,
        );

        const repos: RepoRef[] = [];
        let etag: string | undefined;
        for await (const page of pages) {
          etag ??= page.headers?.etag;
          for (const r of page.data) {
            repos.push({
              owner,
              repo: r.name,
              defaultBranch: r.default_branch ?? 'main',
              archived: Boolean(r.archived),
              ownerKind: kind === 'orgs' ? 'Organization' : 'User',
            });
          }
        }
        if (etag) this.#repoListCache.set(owner, { etag, value: repos });
        return repos;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 304 && cached) return cached.value;
        if (status === 404 && kind === 'orgs') continue;
        throw error;
      }
    }
    return [];
  }

  /**
   * Reads how a repository declares itself: the legacy `.agent-assets.yaml`
   * if it has one, otherwise the `apm.yml` at its root. A 404 on both is the
   * common case, the signal that a repository has not opted in, and is
   * returned as undefined rather than raised.
   *
   * The legacy file is tried first because it can name more than the root
   * package, so a repository that has both keeps publishing what it does today.
   */
  async getManifest(repo: RepoRef): Promise<ManifestFetch | undefined> {
    for (const path of [LEGACY_MANIFEST_FILE, APM_FILE] as const) {
      const raw = await this.#readRootFile(repo, path);
      if (raw !== undefined) {
        return { path, raw, commitSha: await this.#headCommit(repo) };
      }
    }
    return undefined;
  }

  async #readRootFile(repo: RepoRef, path: string): Promise<string | undefined> {
    const key = `${repo.owner}/${repo.repo}/${path}`;
    const cached = this.#manifestCache.get(key);

    try {
      const res = await this.#octokit.rest.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path,
        headers: {
          accept: 'application/vnd.github.raw+json',
          ...(cached ? { 'if-none-match': cached.etag } : {}),
        },
      });
      // With the raw accept header the body is the file itself.
      const raw = res.data as unknown as string;
      const etag = res.headers.etag;
      if (etag) this.#manifestCache.set(key, { etag, value: raw });
      return raw;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 304 && cached) return cached.value;
      if (status === 404) {
        this.#manifestCache.delete(key);
        return undefined;
      }
      throw error;
    }
  }

  /** Every path in the repository at a commit, in one request. */
  async getTree(repo: RepoRef, commitSha: string): Promise<TreeEntry[]> {
    const res = await this.#octokit.rest.git.getTree({
      owner: repo.owner,
      repo: repo.repo,
      tree_sha: commitSha,
      recursive: '1',
    });
    if (res.data.truncated) {
      this.#logger.warn(
        `tree for ${repo.owner}/${repo.repo} was truncated by GitHub, some assets may be missing`,
      );
    }
    return res.data.tree.flatMap(e =>
      e.path && e.sha && e.type
        ? [{ path: e.path, sha: e.sha, type: e.type as TreeEntry['type'] }]
        : [],
    );
  }

  /** Reads a blob by sha. Content addressed, so cached without expiry. */
  async readBlob(repo: RepoRef, blobSha: string): Promise<string> {
    const hit = this.#blobCache.get(blobSha);
    if (hit !== undefined) return hit;

    const res = await this.#octokit.rest.git.getBlob({
      owner: repo.owner,
      repo: repo.repo,
      file_sha: blobSha,
    });
    const content =
      res.data.encoding === 'base64'
        ? Buffer.from(res.data.content, 'base64').toString('utf8')
        : res.data.content;

    if (this.#blobCache.size >= MAX_BLOB_CACHE_ENTRIES) {
      // Oldest first: insertion order is good enough for a cache whose only
      // job is to stop a quiet estate re-downloading itself every ten minutes.
      const oldest = this.#blobCache.keys().next().value;
      if (oldest !== undefined) this.#blobCache.delete(oldest);
    }
    this.#blobCache.set(blobSha, content);
    return content;
  }

  async #headCommit(repo: RepoRef): Promise<string> {
    const ref = await this.#octokit.rest.git.getRef({
      owner: repo.owner,
      repo: repo.repo,
      ref: `heads/${repo.defaultBranch}`,
    });
    return ref.data.object.sha;
  }
}
