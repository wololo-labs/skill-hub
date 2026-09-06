# Scoring an asset

An asset in this catalogue is installable only if it carries an eval score.
That is the whole gate: the hub will render an unscored skill, let you read it
and tell you where it came from, but it will not hand you a command to run.

This page is what the disabled install button links to.

## Why the gate exists

An agent asset is executable text. It changes what a coding agent does on a
developer's machine, and unlike a library it comes with no test suite, no
semver and no download count. "Somebody on the platform team wrote it" is not
evidence. A recorded eval run is.

So the catalogue treats the score the way a package registry treats a
signature: not decoration next to the name, but the thing that decides whether
the install gesture is offered at all.

## What the hub reads

The hub does not compute scores. It reads what a publisher has already
recorded, in one of two places, checked in this order.

### 1. A generated `catalog-info.yaml` beside `apm.yml`

This is the preferred form, because it is the publisher-side contract: the same
entity shape the hub emits, generated from the package rather than written by
hand. The hub reads the `wololo.dev/eval-score` annotation from the `System`
document, and takes the commit out of its `backstage.io/source-location` as the
commit the score was measured at.

That second part is what makes staleness visible. The asset page shows the
commit the asset is pinned to and the commit the score was measured at side by
side, and says so plainly when they differ.

### 2. An `eval-score.json` beside `apm.yml`

The fallback, for a package with no generated catalogue file.

```json
{
  "verdict": "PASS",
  "recorded": "2026-09-04",
  "source": "https://github.com/wololo-labs/wololo-evals/blob/<sha>/README.md#the-benchmark",
  "sourceVisibility": "internal",
  "commit": "422e8f6d59ee1677c81f291ac05e54efec309c02",
  "metrics": {
    "mutation_kill_rate": { "candidate": 0.3012, "baseline": 0.2373 },
    "seeded_defects_caught": { "candidate": 0.3636, "baseline": 0.25 }
  }
}
```

| Field | What it is |
| --- | --- |
| `verdict` | `PASS` or `FAIL`. Anything other than `PASS` renders as a failed gate. |
| `recorded` | The date the gate ran. |
| `source` | A link to the run. The asset page links straight to it. |
| `sourceVisibility` | `internal` labels the link as needing repository access. |
| `commit` | The commit the score was measured at. Omit it and staleness cannot be shown. |
| `metrics` | Each metric as a candidate against its baseline. The first one is the headline on the badge. |

Every metric is a candidate against a baseline on purpose. A bare number says
nothing; a number next to what it beat is a claim someone can check.

## Scope

A score attaches to a **package**, not to a file. Everything inside the package
inherits it, because that is the unit APM installs and the unit the gate
measured. A skill sitting on its own in a repository, outside any package, has
nothing to inherit and stays unscored until it is packaged and measured.

That is a deliberate constraint rather than a gap. Scoring one file in
isolation would mean scoring it without the agents, instructions and MCP
servers it depends on, which is not what anybody installs.

## Getting a score

1. Package the asset: an `apm.yml` at a directory root, with the skills,
   agents and instructions it ships.
2. Run it through the benchmark in
   [wololo-evals](https://github.com/wololo-labs/wololo-evals). Every number
   is recomputed at gate time against the fixture; recorded trajectories are
   not accepted as evidence.
3. Commit the gate output as `eval-score.json` beside `apm.yml`, or regenerate
   the package's `catalog-info.yaml`.
4. Wait one sync. The badge changes and the install button becomes live, with
   no change to this application.

## What the gate is not

It is not a security control. Signing, hashing and scanning live in
wololo-workbench, and a passing score says an asset works, not that it is safe.
It is also not a permission: the hub displays who owns an asset, it does not
enforce who may install it.
