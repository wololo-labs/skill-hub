# Specification: Backstage as the first-party agent-asset hub (skill-hub)

**Generated from:** .agents/plans/backstage-skill-hub.md
**Interview date:** 2026-09-06
**Version:** 1.0

## Executive Summary

Backstage becomes the place an enterprise developer discovers and installs agent
assets: skills, agents, hooks, prompts, eval suites and MCP servers. A new
repository, `wololo-labs/skill-hub`, holds a scaffolded Backstage app, a frontend
plugin (browse, detail, install panel) and a backend entity provider that finds
assets by scanning configured GitHub organisations for an opt-in manifest.
Installation stays with the existing tools: the panel hands the developer the exact
APM or ainb command for their harness, pinned to a commit, and posts a receipt to
Mission Control so the copy is on the record. Three days, demo-ready or cut.

## Objectives

### Primary Goals

- Make Backstage the browse-and-discover surface for every agent asset, so
  ainb-toolkit is a publisher rather than the hub.
- Give the install gesture the feel of npm: search, read, one copyable line.
- Refuse the install gesture for anything with no eval score, so the score is a
  gate and not decoration.
- Prove the loop on camera: a new repo opts in, appears, and its skill installs and
  runs in a real harness.

### Success Metrics

- A repo that adds `.agent-assets.yaml` appears in the catalogue within one sync
  (10 minutes) with no Backstage config change.
- Every asset type in the vocabulary renders with owner, harness targets,
  provenance sha and score or an unscored badge.
- A copied command installs the pack into Claude Code and into Copilot, verified
  live.
- Each copy produces a Mission Control receipt naming actor, asset, commit and
  score at the time.

## Scope

### In Scope

- New repo `wololo-labs/skill-hub`: scaffolded Backstage app, `plugins/skill-hub`
  (frontend), `plugins/skill-hub-backend` (entity provider plus receipt poster),
  Docker Compose with Postgres.
- Discovery by manifest: configured orgs, one contents lookup per repo per sync.
- Entity model on `kind: AiResource` with native and extended `spec.type` values,
  `kind: API` for MCP servers, `kind: System` for a pack.
- Browse page with facets, detail page with rendered body and provenance, install
  panel with a per-harness command.
- GitHub OAuth for real identity and ownership.
- Receipt posted to Mission Control on copy.

### Out of Scope

- Backstage writing to a developer machine, or a scaffolder PR flow.
- Roadie compatibility work (kept in mind, not built or tested).
- Replacing wololo-workbench as the trust surface (signing, hashing, scanning stay
  there).
- Publishing catalogue entities for repos that have not opted in.

### Future Considerations

- Roadie port, once the client's hosting answer is known.
- Scorecards over eval coverage per team.
- MCP Actions backend so Backstage actions themselves become agent tools.
- Entitlement: who may install what, enforced rather than displayed.

## Technical Requirements

### Architecture

```
 GitHub orgs (config)                 skill-hub repo
 ┌──────────────────┐        ┌──────────────────────────────────┐
 │ repo A           │        │ plugins/skill-hub-backend        │
 │  .agent-assets   │◀───────│  every 10 min:                   │
 │  skills/*/SKILL  │  GET   │   list repos in org              │
 │  packages/*/apm  │        │   GET .agent-assets.yaml         │
 ├──────────────────┤        │   200 emit entities · 404 skip   │
 │ repo B (no file) │        └──────────────┬───────────────────┘
 └──────────────────┘                       │ AiResource · API · System
                                            ▼
                              ┌──────────────────────────────────┐
                              │ Backstage catalog (Postgres)     │
                              └──────────────┬───────────────────┘
                                             │
                              ┌──────────────▼───────────────────┐
                              │ plugins/skill-hub (frontend)     │
                              │  SkillsPage  facets, search      │
                              │  AssetPage   body, provenance,   │
                              │              score, install panel│
                              └──────────────┬───────────────────┘
                                             │ copy
                              ┌──────────────▼───────────────────┐
                              │ backend receipt poster           │
                              │  POST Mission Control receipts   │
                              └──────────────────────────────────┘
```

### Components

| Component | Purpose | Technology |
|---|---|---|
| skill-hub app | Scaffolded Backstage host | `@backstage/create-app`, Node 20 |
| plugins/skill-hub | Browse, detail, install panel | React, Backstage frontend plugin API |
| plugins/skill-hub-backend | Manifest scan, entity provider, receipt poster | Backstage backend module, Octokit |
| catalog store | Entity persistence | Postgres 16 in Compose |
| publisher side | Emits entities and the well-known index | ainb-toolkit PR #49 generator |
| score source | Mutation kill rate per asset | wololo-evals gate report |
| receipt sink | Who copied what, when | Mission Control receipts route |

### Manifest contract

```yaml
# .agent-assets.yaml at the repo root, the only opt-in signal
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

### Entity model

| Thing | Kind | spec.type | Native |
|---|---|---|---|
| Skill | AiResource | `skill` | yes |
| Rule or instruction set | AiResource | `rule` | yes |
| Agent definition | AiResource | `agent` | ours |
| Hook | AiResource | `hook` | ours |
| Prompt | AiResource | `prompt` | ours |
| Eval suite | AiResource | `eval-suite` | ours |
| MCP server | API | `mcp-server` | yes |
| A package or pack | System | n/a | yes |

Annotations carried on every entity: `backstage.io/source-location` pinned to the
commit sha, `wololo.dev/eval-score` (absent means unscored), `wololo.dev/harnesses`
(claude, copilot, codex), `wololo.dev/install` (the command template).

### Integrations

- **GitHub**: org listing and contents reads with a token; OAuth for user identity.
- **ainb-toolkit #49**: generator output is the publisher-side contract; the hub
  reads the same entity shape rather than inventing a second one.
- **wololo-evals**: the score annotation comes from a gate report, not from a
  hand-edited file.
- **Mission Control**: receipts route, DB-issued token, tenant from the binding.

### Performance Requirements

- Sync of two orgs completes inside the 10-minute schedule with one contents call
  per repo.
- A 404 on the manifest is the common case and must be cheap and unlogged as an
  error.

### Security Requirements

- GitHub token is read-only, scoped to public and the named orgs, held in Compose
  env, never in the repo.
- OAuth client secret likewise.
- The Mission Control token is a DB-issued agent token with only the receipts
  scope.
- No asset content is copied into the catalogue database beyond what the entity
  needs; the body is fetched for rendering and cited by source-location.

## User Experience

### User Flows

1. **Discover**: open Skills, filter by type, harness, owner or score, search by
   name and description.
2. **Evaluate**: open an asset, read the rendered body, see the owner, the commit it
   is pinned to, and the score with the run it came from.
3. **Install**: pick a harness, copy the command, run it locally.
4. **Publish**: add `.agent-assets.yaml` to a repo, wait one sync, see it appear.

### Edge Cases

| Scenario | Expected behaviour |
|---|---|
| Asset has no eval score | Renders with an unscored badge; install button disabled with a link to how to score it |
| Manifest present but malformed | Repo skipped, one clear error on the entity provider's status, never a crash |
| Repo removes the manifest | Entities disappear on the next sync (provider is authoritative for what it emitted) |
| Two repos publish the same skill name | Both appear, namespaced by repo; the detail page shows which repo owns which |
| Score exists but is stale relative to the pinned commit | Badge shows the score and the commit it was measured at; mismatch is visible |
| Manifest path glob matches nothing | Repo appears with zero assets rather than silently vanishing |

## Constraints and Dependencies

### Technical Constraints

- Extended `spec.type` values are ours, so a stock Backstage may not render them
  specially; the plugin must not depend on upstream rendering.
- Manifest-only discovery means a repo is invisible until it opts in, by design.
- Backstage plugin scaffolding and the new backend system are fiddly; budget for it.

### External Dependencies

- `@backstage/plugin-catalog-backend-module-ai-model` for the AiResource kind.
- GitHub API availability and rate limits.
- Mission Control being reachable for receipts (degrade to a queued retry, never
  block the copy).

### Timeline Constraints

- Three days, demo-ready or cut. Audit receipts and OAuth are the first things to
  cut if the browse and install path is at risk.
- Must not consume the slack reserved for the reflect stack fixes and slice B.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Backstage plugin scaffolding eats the timebox | High | Med | Day one is compose plus provider only; UI on day two, install panel day three |
| Client runs Roadie and rejects custom plugins | High | Med | Entity shape stays stock, so the catalogue survives even if the plugin does not |
| Nothing has a score, so every install is blocked | Med | High | Score the qe-agent-pack first; the demo uses it as the scored example and an unscored one as contrast |
| Rate limits on org walks | Med | Low | Ten-minute schedule, conditional requests, cache by repo etag |
| Receipts couple the hub to Mission Control | Med | Med | Fire and forget with a local queue; a failed post never blocks the copy |

## Decisions Made

### Key Trade-offs

- **Install is a copied command, not an action.** Alternatives: a scaffolder PR into
  the developer's repo, or a machine-local agent. Rationale: repo PRs only fit
  repo-scoped installs and not a developer's own harness config, and Backstage
  reaching into laptops is unsellable in an enterprise.
- **Discovery is manifest-only, no topic.** Alternatives: a GitHub topic, or code
  search. Rationale: one signal, not two to keep in sync; the org walk is cheap at
  this scale and does not depend on code search freshness.
- **AiResource with extended types.** Alternatives: Component with a type, or a
  custom kind. Rationale: keeps every asset out of the service views without
  breaking stock pages or a future Roadie port.
- **Self-hosted first, Roadie later.** Rationale: a hosted tenant cannot host a
  custom backend, so the plugin has to be built somewhere it can run.
- **Merge ainb-toolkit #49 now.** Rationale: its generator is the publisher side of
  exactly this contract; the hub consumes what it emits.

### Deferred Decisions

- Roadie port: deferred until the client's hosting answer is known.
- Entitlement enforcement (who may install what): displayed only, not enforced.
- Whether the hub or workbench owns signing verification at install time.

## Implementation Notes

### Priority Order

1. Repo, scaffolded app, Docker Compose with Postgres, guest auth, one hand-written
   entity to prove the pipeline.
2. Backend entity provider: org config, manifest fetch, entity emission for every
   type, schedule, status reporting.
3. `.agent-assets.yaml` added to ainb-toolkit so the real assets appear.
4. Frontend: browse page with facets, detail page with rendered body, provenance and
   score.
5. Install panel with per-harness command and the unscored block.
6. GitHub OAuth.
7. Receipt post to Mission Control.

### Technical Debt Accepted

- Extended spec types are non-standard: accepted, documented in the repo README.
- The score annotation is copied onto the entity rather than resolved live:
  accepted, with the measurement commit shown so staleness is visible.
- Compose uses a single Postgres with default credentials for local use only.

## Open Questions

- [ ] Which asset in the estate gets scored second, so the catalogue has more than
      one green example on camera?
- [ ] Does the install command for a single skill differ from a pack, and does the
      panel need both shapes?
- [ ] Where does the demo run: your machine, or a throwaway cloud host so a sponsor
      can click it?

---

*This specification was generated through systematic interview of the plan author.*
