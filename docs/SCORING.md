# Scoring an asset

An asset in this catalogue is installable only if an eval gate has run against
it and passed. That is the whole gate: the hub will render an unscored skill,
let you read it and tell you where it came from, but it will not hand you a
command to run. An asset whose gate failed is blocked the same way, and says so
in different words: a report that measures the asset not working is not a reason
to hand the command over, it is the reason not to.

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
recorded, in one of three places, checked in this order.

### 1. The gate's own report, `eval-gate-report.json` beside `apm.yml`

The preferred form, because it is the only one nobody has to transcribe. It is
the file `wololo-evals-cli gate -o` wrote, committed unchanged. The hub takes
the verdict from the report's verdict, each metric from a signal's two means,
and the commit from `subject.commit`, so a number in the catalogue cannot drift
from the run that produced it without the report itself being edited.

```json
{
  "schema_version": "1.0.0",
  "verdict": "pass",
  "recorded": "2026-09-04",
  "source": "https://github.com/wololo-labs/wololo-evals/actions/runs/33898453721",
  "sourceVisibility": "internal",
  "subject": {
    "repo": "wololo-labs/estate",
    "path": "packages/qe-agent-pack",
    "commit": "422e8f6d59ee1677c81f291ac05e54efec309c02"
  },
  "signals": [
    {
      "evaluator_id": "mutation_kill_rate",
      "candidate_mean": 0.3012,
      "baseline_mean": 0.2373,
      "guarded": true
    }
  ]
}
```

| Field | What it is |
| --- | --- |
| `verdict` | The gate's verdict. Only `pass` opens the install gesture; `regression` and `refused` block it and are shown as themselves. |
| `recorded` | The date the gate ran. |
| `source` | A link to the run. The asset page links straight to it. |
| `sourceVisibility` | `internal` labels the link as needing repository access. |
| `subject.commit` | The commit of the asset the gate measured. Omit it and the score still counts, but staleness cannot be shown. |
| `signals` | Every evaluator the gate scored, as a candidate mean against a baseline mean. Guarded signals are read first, so the headline on the badge is a signal the gate would have failed on. |

Everything else the gate writes, the reason, the statistics, the quarantined
cases, is carried in the file and ignored by the hub.

### 2. A generated `catalog-info.yaml` beside `apm.yml`

The publisher-side contract: the same entity shape the hub emits, generated
from the package rather than written by hand. The hub reads the
`wololo.dev/eval-score` annotation from the `System` document, and takes the
commit out of its `backstage.io/source-location` as the commit the score was
measured at.

Staleness is shown the same way whichever form a score arrives in. The asset
page puts the commit the asset is pinned to and the commit the score was
measured at side by side, and says so plainly when they differ.

### 3. An `eval-score.json` beside `apm.yml`

The last fallback, for a package with neither a gate report nor a generated
catalogue file. Every number in it is a transcription, which is why it sits
below both.

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
| `verdict` | `PASS` or `FAIL`. Anything other than `PASS`, a missing verdict included, renders as a failed gate and blocks install. |
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
3. Commit the gate's `-o` output unchanged as `eval-gate-report.json` beside
   `apm.yml`. Editing it to tidy the numbers is the one thing that breaks the
   chain back to the run.
4. Wait one sync. The badge changes and the install button becomes live, with
   no change to this application.

## What the gate is not

It is not a security control. Signing, hashing and scanning live in
wololo-workbench, and a passing score says an asset works, not that it is safe.
It is also not a permission: the hub displays who owns an asset, it does not
enforce who may install it.
