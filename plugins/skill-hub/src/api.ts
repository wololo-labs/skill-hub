import {
  createApiRef,
  DiscoveryApi,
  FetchApi,
} from '@backstage/core-plugin-api';

export interface AssetBody {
  content: string | null;
  path?: string;
  commit?: string;
  url?: string;
  reason?: string;
}

export interface SkillHubApi {
  /** The asset body, fetched server side so the GitHub token stays there. */
  getAssetBody(entityRef: string): Promise<AssetBody>;
  /**
   * Records that a command was copied. Never throws and never blocks: a
   * receipt that cannot be recorded must not cost the developer the copy.
   */
  recordCopy(entityRef: string, harness: string): Promise<void>;
}

export const skillHubApiRef = createApiRef<SkillHubApi>({
  id: 'plugin.skill-hub.service',
});

export class SkillHubClient implements SkillHubApi {
  readonly #discovery: DiscoveryApi;
  readonly #fetch: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.#discovery = options.discoveryApi;
    this.#fetch = options.fetchApi;
  }

  async getAssetBody(entityRef: string): Promise<AssetBody> {
    const base = await this.#discovery.getBaseUrl('skill-hub');
    const response = await this.#fetch.fetch(
      `${base}/assets/${encodeURIComponent(entityRef)}/body`,
    );
    if (!response.ok) {
      throw new Error(
        `could not load the asset body: ${response.status} ${response.statusText}`,
      );
    }
    return response.json();
  }

  async recordCopy(entityRef: string, harness: string): Promise<void> {
    try {
      const base = await this.#discovery.getBaseUrl('skill-hub');
      await this.#fetch.fetch(`${base}/receipts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityRef, harness }),
      });
    } catch {
      // Fire and forget by design.
    }
  }
}
