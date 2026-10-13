#!/bin/sh
set -e

# Compose has no way to pass an environment variable conditionally: an unset
# value in .env arrives as an empty string, not as absent. Backstage treats
# those differently. An unset ${VAR} makes it drop the key, which is what
# optional config expects; an empty one is a present value of the wrong shape.
#
# Empty means absent. Unset those variables here, once, before the backend
# ever reads them.
for name in \
  GITHUB_TOKEN \
  AUTH_GITHUB_CLIENT_ID \
  AUTH_GITHUB_CLIENT_SECRET \
  RECEIPT_SERVICE_BASE_URL \
  RECEIPT_SERVICE_TOKEN
do
  eval "value=\$$name"
  if [ -z "$value" ]; then
    unset "$name"
  fi
done

# The GitHub sign-in provider is all or nothing: Backstage initialises any
# provider block it finds and refuses one without a client id, so an
# unconfigured clone cannot simply leave the values blank. The block is
# written only when there is something to put in it, and appended as one more
# --config layer.
EXTRA=""
if [ -n "${AUTH_GITHUB_CLIENT_ID:-}" ] && [ -n "${AUTH_GITHUB_CLIENT_SECRET:-}" ]; then
  cat > /tmp/app-config.github-auth.yaml <<YAML
auth:
  providers:
    github:
      development:
        clientId: \${AUTH_GITHUB_CLIENT_ID}
        clientSecret: \${AUTH_GITHUB_CLIENT_SECRET}
        signIn:
          resolvers:
            - resolver: usernameMatchingUserEntityName
              dangerouslyAllowSignInWithoutUserInCatalog: true
YAML
  EXTRA="--config /tmp/app-config.github-auth.yaml"
  echo "skill-hub: GitHub sign-in enabled"
else
  echo "skill-hub: no GitHub OAuth client configured, guest sign-in only"
fi

exec "$@" $EXTRA
