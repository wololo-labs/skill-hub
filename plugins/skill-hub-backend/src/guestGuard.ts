import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';

/** Hostnames that mean "this machine", and nothing that another machine reaches. */
const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];

export function isLoopbackUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOOPBACK.includes(new URL(url).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

/**
 * Guest sign-in hands anyone who opens the page a `user` principal, and the
 * routes behind that principal read repository contents with the server's own
 * GitHub token. That is an acceptable trade on a laptop and an unacceptable one
 * anywhere else, so the deployment has to prove it is local: if the hub calls
 * itself anything but localhost while guest is enabled, it refuses to start
 * rather than quietly serving private repository contents to the internet.
 *
 * The way out is to configure a GitHub OAuth client and drop the guest provider
 * from config, which is what the comment in app-config.production.yaml has
 * always asked for. This makes that a rule instead of a request.
 */
export const authModuleGuestGuard = createBackendModule({
  pluginId: 'auth',
  moduleId: 'skill-hub-guest-guard',
  register(env) {
    env.registerInit({
      deps: { config: coreServices.rootConfig, logger: coreServices.logger },
      async init({ config, logger }) {
        if (!config.has('auth.providers.guest')) return;

        const baseUrl = config.getOptionalString('backend.baseUrl');
        const appUrl = config.getOptionalString('app.baseUrl');
        if (isLoopbackUrl(baseUrl) && isLoopbackUrl(appUrl)) {
          logger.info(
            'skill-hub: guest sign-in is enabled and the hub is bound to localhost',
          );
          return;
        }

        throw new Error(
          `guest sign-in is enabled but this hub is not local (backend.baseUrl ${baseUrl}, app.baseUrl ${appUrl}). ` +
            'Guest makes every visitor a signed-in user, and the asset body route reads private repositories with the server token. ' +
            'Configure AUTH_GITHUB_CLIENT_ID and AUTH_GITHUB_CLIENT_SECRET and remove auth.providers.guest before serving this anywhere else.',
        );
      },
    });
  },
});
