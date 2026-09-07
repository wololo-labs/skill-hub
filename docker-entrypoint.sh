#!/bin/sh
# Compose has no way to pass an environment variable conditionally: an unset
# value in .env arrives as an empty string, not as absent. Backstage treats
# those differently. An unset ${VAR} makes it drop the key, which is what
# optional config expects; an empty one is a present value of the wrong shape,
# so the auth and skill-hub plugins both refused to start on a clean clone
# with no OAuth application and no Mission Control.
#
# Empty means absent. Unset those variables here, once, before the backend
# ever reads them.
for name in \
  GITHUB_TOKEN \
  AUTH_GITHUB_CLIENT_ID \
  AUTH_GITHUB_CLIENT_SECRET \
  MISSION_CONTROL_BASE_URL \
  MISSION_CONTROL_TOKEN
do
  eval "value=\$$name"
  if [ -z "$value" ]; then
    unset "$name"
  fi
done

exec "$@"
