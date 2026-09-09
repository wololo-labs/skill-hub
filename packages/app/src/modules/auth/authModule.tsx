import { SignInPage } from '@backstage/core-components';
import {
  SignInPageProps,
  githubAuthApiRef,
} from '@backstage/core-plugin-api';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';

/**
 * Sign in with GitHub, which is what puts a real name on an install receipt.
 *
 * Guest stays on the page so a clean clone is usable before anyone has
 * registered an OAuth application. The GitHub button only works once
 * AUTH_GITHUB_CLIENT_ID and AUTH_GITHUB_CLIENT_SECRET are set.
 */
const signInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => (props: SignInPageProps) => (
      <SignInPage
        {...props}
        title="Sign in to the skill hub"
        providers={[
          'guest',
          {
            id: 'github-auth-provider',
            title: 'GitHub',
            message: 'Sign in with GitHub to put your name on an install',
            apiRef: githubAuthApiRef,
          },
        ]}
      />
    ),
  },
});

export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [signInPage],
});
