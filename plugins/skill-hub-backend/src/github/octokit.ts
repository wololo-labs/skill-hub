import { LoggerService, RootConfigService } from '@backstage/backend-plugin-api';
import { ScmIntegrations } from '@backstage/integration';
import { Octokit } from '@octokit/rest';

/**
 * One Octokit, built from the standard `integrations.github` config so the
 * hub does not invent a second place to put a GitHub token.
 *
 * Without a token the client still works against public repositories, at the
 * unauthenticated rate limit, which is enough to boot but not enough to scan
 * an estate. That is worth saying out loud at startup rather than surfacing
 * later as a mystery 403.
 */
export function createOctokit(options: {
  config: RootConfigService;
  logger: LoggerService;
}): Octokit {
  const github = ScmIntegrations.fromConfig(options.config).github.byHost(
    'github.com',
  );
  if (!github?.config.token) {
    options.logger.warn(
      'no github.com token in integrations.github, falling back to unauthenticated requests',
    );
  }
  return new Octokit({
    auth: github?.config.token,
    userAgent: 'wololo-labs/skill-hub',
    // A 404 on the manifest is the common case, not an incident: most
    // repositories have not opted in and never will. Keeping it at debug is
    // what makes a scan of several hundred repositories readable.
    log: {
      debug: (message: string) => options.logger.debug(message),
      info: (message: string) => options.logger.debug(message),
      warn: (message: string) =>
        /\b(404|451)\b/.test(message)
          ? options.logger.debug(message)
          : options.logger.warn(message),
      error: (message: string) => options.logger.error(message),
    },
  });
}
