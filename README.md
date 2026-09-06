# skill-hub

Backstage as the first-party catalogue and hub for agent assets: skills,
agents, hooks, prompts, eval suites, MCP servers and packs.

A developer opens Backstage, browses everything the estate publishes, opens one
asset, sees where it came from and what it scored, copies one command, and it
installs into their harness. Repositories opt in by adding a manifest; nothing
is registered by hand.

```
 opt-in repos                     skill-hub
 .agent-assets.yaml  ──scan──▶  entity provider  ──▶  Backstage catalog
                                                          │
                                                  browse · detail · install
                                                          │
                                                  receipt to Mission Control
```

## Run

```bash
cp .env.example .env   # GITHUB_TOKEN at minimum
docker compose up
```

The hub is on http://localhost:7007. It boots on guest identity with no
credentials at all; a `GITHUB_TOKEN` is what gives it an estate to scan.

For development, `yarn install && yarn start` runs the app on 3000 against a
backend on 7007, with an in-memory database.

## Layout

| Path | Purpose |
| --- | --- |
| `packages/app`, `packages/backend` | the Backstage host, trimmed to what a catalogue needs |
| `packages/app/src/modules/theme` | the hub's light and dark themes |
| `plugins/skill-hub` | browse page, asset detail, install panel |
| `plugins/skill-hub-backend` | manifest discovery, entity provider, body proxy, receipt queue |
| `plugins/skill-hub-common` | the annotation vocabulary both halves agree on |
| `docker-compose.yml` | app plus Postgres, one command |
| `docs/SPEC.md` | the agreed specification this build follows |
| `docs/SCORING.md` | how an asset gets a score, and why the gate exists |
| `PRODUCT.md` | who this is for, and what it must not become |

## Publishing into it

Add `.agent-assets.yaml` to the root of any repository owned by a configured
organisation or user. The provider picks it up on the next sync, with no change
to this application. Delete the file and its assets disappear on the sync after
that: the provider is authoritative for what it emitted.

```yaml
owner: team-ai-platform      # required. A bare name means group:default/<name>.
system: ai-tooling           # optional. A pack claims its own members first.
harnesses: [claude, copilot, codex]   # optional, defaults to all three

publish:
  skills:   skills/*/SKILL.md
  rules:    rules/*.md
  agents:   agents/**/*.agent.md
  hooks:    utilities/hooks/*.py
  prompts:  prompts/*.md
  evals:    evals/*.eval.md
  packages: packages/*/apm.yml
  mcp:      mcp/*.json
```

Every key takes a string or a list of strings. A repository with a manifest and
no matches appears with zero assets rather than vanishing, and a manifest that
cannot be parsed is skipped with one line on the provider's status without
stopping the sync.

### What each key produces

| Key | Kind | `spec.type` | Native to Backstage |
| --- | --- | --- | --- |
| `skills` | `AiResource` | `skill` | yes |
| `rules` | `AiResource` | `rule` | yes |
| `agents` | `AiResource` | `agent` | ours |
| `hooks` | `AiResource` | `hook` | ours |
| `prompts` | `AiResource` | `prompt` | ours |
| `evals` | `AiResource` | `eval-suite` | ours |
| `mcp` | `API` | `mcp-server` | yes |
| `packages` | `System` | n/a | yes |

The four extended `spec.type` values are ours. A stock Backstage will not
render them specially, so the plugin never depends on upstream doing so; the
entity shape stays valid against the `AiResource` schema either way, which is
what keeps a future move to a hosted Backstage open.

A skill is addressed by its directory, because a skill is a directory of files.
Everything else is addressed by its file.

### Annotations carried on every entity

| Annotation | What it carries |
| --- | --- |
| `backstage.io/source-location` | the asset, pinned to the commit it was read at |
| `wololo.dev/repo`, `wololo.dev/commit` | where it came from |
| `wololo.dev/harnesses` | which harnesses it targets, and the marker that makes an entity an agent asset |
| `wololo.dev/install` | one command per harness, pinned |
| `wololo.dev/eval-score` | the gate report, absent when unscored |
| `wololo.dev/eval-score-ref` | the pack a member inherits its score from |

## Configuration

```yaml
skillHub:
  owners: [stevengonsalvez, wololo-labs]   # organisations or user accounts
  schedule:
    frequency: { minutes: 10 }
    timeout: { minutes: 9 }
  missionControl:                          # omit to log copies locally instead
    baseUrl: ${MISSION_CONTROL_BASE_URL}
    token: ${MISSION_CONTROL_TOKEN}
```

Every secret arrives through the environment. See `.env.example`.

A sync is one contents lookup per repository, eight at a time. A 404 is the
common case and costs nothing; etags mean an unchanged owner listing is a 304,
which GitHub does not charge against the rate limit, and blob bodies are cached
by their content-addressed sha so an unchanged file is never fetched twice.
Scanning 387 repositories takes about twelve seconds.

## Routes the backend adds

| Route | Purpose |
| --- | --- |
| `GET /api/skill-hub/status` | the last sync: what published, what failed, and why |
| `GET /api/skill-hub/assets/:entityRef/body` | the asset body, read server side so the token stays there |
| `POST /api/skill-hub/receipts` | records a copy; returns 202 before delivery is attempted |

The body route will only read a repository the provider actually published, at
the commit the entity is pinned to, under the asset's own path. Without those
three checks, anyone able to register a catalogue location could use the hub's
own credential to read a private repository.

## Accepted trade-offs

- **The score is copied onto the entity** rather than resolved live, so the
  install gate is a local check. The commit it was measured at travels with it,
  and the asset page says so when that is not the commit the asset is pinned to.
- **Receipts are held in memory.** A restart loses undelivered ones. That is
  the price of never coupling a copy to a second service being up.
- **Compose runs one Postgres with default credentials** and guest identity.
  Local use only; both are named in `app-config.production.yaml`.
- **Browse filters in the browser** over the full result set, which is what
  makes the facet counts exact. The ceiling is a few thousand assets.
