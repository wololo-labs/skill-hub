# skill-hub

Backstage as the first-party catalogue and hub for agent assets: skills, agents,
hooks, prompts, eval suites and MCP servers.

A developer opens Backstage, browses everything the estate publishes, opens one
asset, sees where it came from and what it scored, copies one command, and it
installs into their harness. Repositories opt in by adding a manifest; nothing is
registered by hand.

```
 opt-in repos                     skill-hub
 .agent-assets.yaml  ──scan──▶  entity provider  ──▶  Backstage catalog
                                                          │
                                                  browse · detail · install
                                                          │
                                                  receipt to Mission Control
```

## Layout

| Path | Purpose |
| --- | --- |
| `packages/app`, `packages/backend` | the scaffolded Backstage host |
| `plugins/skill-hub` | browse page, asset detail, install panel |
| `plugins/skill-hub-backend` | manifest discovery, entity provider, receipt poster |
| `docker-compose.yml` | app plus Postgres, one command |
| `docs/SPEC.md` | the agreed specification this build follows |

## Run

```bash
cp .env.example .env   # GITHUB_TOKEN, OAuth client, Mission Control token
docker compose up
```

Backstage listens on 7007.

## Publishing into it

Add `.agent-assets.yaml` to the root of any repository in a configured
organisation. The provider picks it up on the next sync.

```yaml
owner: team-ai-platform
system: ai-tooling
publish:
  skills:   skills/*/SKILL.md
  agents:   agents/**/*.agent.md
  hooks:    utilities/hooks/*.py
  prompts:  prompts/*.md
  packages: packages/*/apm.yml
  mcp:      mcp/*.json
```
