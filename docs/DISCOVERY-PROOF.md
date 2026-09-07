# Discovery proof

Run against the live hub on 2026-09-06, with a real GitHub token over 388
repositories in two owners. Nothing here is a unit test standing in for the
real thing; the timestamps are from the running provider's own log.

## A repository appears within one sync, with no change to the hub

A fresh private repository, `wololo-labs/agent-assets-fixture`, holding three
assets and one `.agent-assets.yaml`. The hub was never told about it: no
configuration was edited, nothing was restarted, and the repository is not
named anywhere in this codebase.

```console
$ git push -u origin main        # 23:28:14Z, commit 46c53a2a
```

The next scheduled sync, three minutes later:

```
23:31:04.991  catalog  info  wololo-labs/agent-assets-fixture published 3 entities at 46c53a2a
23:31:05.005  catalog  info  agent asset sync finished: 130 entities from 2 of 388 repositories in 13525ms
```

The provider's status route, at that point:

```json
{
  "repository": "wololo-labs/agent-assets-fixture",
  "state": "published",
  "commit": "46c53a2acf74e66a80a4d09ae71e52d9ef4e27a6",
  "assets": { "skills": 1, "agents": 1, "hooks": 1 },
  "entityCount": 3
}
```

## A malformed manifest is skipped, and the sync finishes

The same repository, with `widgets:` added under `publish:`, pushed at
23:33:56Z. One line, naming the offending key and the keys that exist:

```
23:41:05.168  catalog  error  skipping wololo-labs/agent-assets-fixture: .agent-assets.yaml is not usable:
                              unknown publish key widgets, expected one of skills, rules, agents, hooks,
                              prompts, evals, packages, mcp
23:41:05.184  catalog  info   agent asset sync finished: 127 entities from 1 of 388 repositories in 12756ms
```

The other repository published its 127 entities in the same run. One bad
manifest costs its own repository and nothing else.

## Removing the manifest removes the assets

`git rm .agent-assets.yaml`, pushed at 23:42:44Z.

```
23:51:02.488  catalog  info  agent asset sync finished: 127 entities from 1 of 388 repositories in 12054ms
```

```console
$ curl .../api/catalog/entities | jq '[.[] | select(.metadata.namespace=="wololo-labs-agent-assets-fixture")] | length'
0
```

The repository is also gone from the provider's status entirely, rather than
being reported as an error. Not publishing is the normal state, not a fault.

## Cost of a sync

388 repositories, two owners, in roughly twelve seconds. One contents lookup
per repository, eight at a time; a 404 is the common case and is not logged as
an error. Two repositories are reported as errors every run because GitHub
returns 451 for them, which is honest: the hub could not determine whether they
opted in.

## Receipts reach Mission Control, and never hold up a copy

With a Mission Control stand-in configured:

```console
$ curl -X POST .../api/skill-hub/receipts -d '{"entityRef":"system:.../qe-agent-pack","harness":"claude"}'
status=202 time=0.054318s
```

What arrived on the other side:

```json
{
  "method": "POST",
  "url": "/api/receipts",
  "auth": "Bearer <redacted>",
  "body": {
    "kind": "agent-asset-install",
    "actor": "user:development/guest",
    "entityRef": "system:stevengonsalvez-ainb-toolkit/qe-agent-pack",
    "harness": "claude",
    "commit": "937cc70d4a371e4189e891a113fe5374eaefaaa9",
    "verdict": "PASS",
    "copiedAt": "2026-09-07T00:16:17.471Z"
  }
}
```

Actor, asset, commit and the verdict at the time of the copy.

Then with Mission Control stopped:

```console
$ curl -X POST .../api/skill-hub/receipts -d '{"entityRef":"airesource:.../commit","harness":"codex"}'
status=202 time=0.015162s
```

```json
{ "configured": true, "queued": 1, "delivered": 1, "dropped": 0 }
```

```
00:16:30.357  skill-hub  warn  could not post a receipt to Mission Control, will retry: fetch failed
```

Fifteen milliseconds, with the sink down. The receipt is held for the retry and
the developer never learns that anything was wrong, which is the point.

## The whole thing from `docker compose up`

Run on 2026-09-07 against a clean `.env` holding only a `GITHUB_TOKEN`: no
OAuth application, no Mission Control, which is the state a first-time reader
is in.

```console
$ docker compose up -d
 Container skill-hub-postgres-1   Healthy
 Container skill-hub-skill-hub-1  Started

$ docker compose ps
postgres    Up (healthy)
skill-hub   Up            0.0.0.0:7007->7007/tcp
```

The container's own log:

```
skill-hub: no GitHub OAuth client configured, guest sign-in only
Listening on :7007
stevengonsalvez/ainb-toolkit published 127 entities at 937cc70d
wololo-labs/agent-assets-fixture published 3 entities at 66b9e563
agent asset sync finished: 130 entities from 2 of 389 repositories in 17015ms
```

Zero plugins threw during startup. Driven in a browser against port 7007, with
no development server running anywhere:

```
rows rendered   130
count line      "130 of 130 assets"
leading rows    playwright-test MCP server, qe-agent-pack 0.1.0   (both PASS)
page errors     none
sign-in offers  Guest only
```

### What only this test could find

Three defects existed exclusively in the container, and none of them are
reachable from `yarn start`, the test suite or the linter, because in
development those environment variables are genuinely unset rather than blank.

1. Compose cannot pass a variable conditionally, so an empty line in `.env`
   arrives as `""`. Backstage drops a key whose `${VAR}` is unset, which is
   what optional config depends on, but an empty string is a present value of
   the wrong type. `skillHub.missionControl.baseUrl` was rejected outright.
2. The same fault took down `auth` on
   `auth.providers.github.development.clientId`.
3. Unsetting the variables was not enough: Backstage initialises whatever
   provider block it finds and refuses one with no client id, so the block
   itself had to become conditional. The entrypoint writes it only when there
   is something to write, and says which mode it chose.

The failure was also disguised. The container served `200` on `/` from its
static assets while the backend was shutting down behind them, and an earlier
version of this check reported a healthy hub that was in fact the development
server still holding port 7007.
