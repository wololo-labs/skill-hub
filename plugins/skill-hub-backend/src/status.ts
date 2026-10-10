import {
  createServiceFactory,
  createServiceRef,
} from '@backstage/backend-plugin-api';
import { AssetKind } from './provider/manifest';

export interface RepositoryStatus {
  repository: string;
  /**
   * `published` emitted entities, `error` had a manifest that could not be
   * honoured. Repositories with no manifest are not reported: not opting in
   * is the normal state, not a condition to explain.
   */
  state: 'published' | 'error';
  commit?: string;
  assets?: Partial<Record<AssetKind, number>>;
  entityCount?: number;
  /** Things the owner should fix that did not stop the repository publishing. */
  warnings?: string[];
  error?: string;
}

export interface SkillHubStatus {
  lastRunStartedAt?: string;
  lastRunFinishedAt?: string;
  lastRunDurationMs?: number;
  lastRunError?: string;
  owners: string[];
  repositoriesScanned: number;
  entityCount: number;
  repositories: RepositoryStatus[];
}

/**
 * The entity provider's status, readable over HTTP.
 *
 * The provider runs inside the catalog plugin and the route that reports on it
 * lives in the skill-hub plugin, so this is a root scoped service: one
 * instance, shared by both, rather than a module level singleton.
 */
export interface SkillHubStatusService {
  get(): SkillHubStatus;
  set(status: SkillHubStatus): void;
}

const EMPTY: SkillHubStatus = {
  owners: [],
  repositoriesScanned: 0,
  entityCount: 0,
  repositories: [],
};

export const skillHubStatusServiceRef =
  createServiceRef<SkillHubStatusService>({
    id: 'skill-hub.status',
    scope: 'root',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: {},
        async factory() {
          let current: SkillHubStatus = EMPTY;
          return {
            get: () => current,
            set: (status: SkillHubStatus) => {
              current = status;
            },
          };
        },
      }),
  });
