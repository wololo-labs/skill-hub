# Scoring assets

The hub displays score metadata supplied by a publisher. It does not run an
evaluation or certify an asset.

An asset with a passing gate report can expose supported install commands. An
unscored or failing asset remains visible for inspection but is not offered for
installation. Operators decide which report formats and policy thresholds their
deployment accepts.

Reports can contain repository names, commit identifiers, and evaluation data.
Publish only reports that are safe to share with every user of the hub.

## Declaring an evaluation in apm.yml

A package can declare how it is evaluated with an `eval:` mapping in its
`apm.yml`. The hub reads only whether the block is present. It never takes a
number, verdict or threshold from it, and it never runs the evaluation.

| apm.yml | report beside it | what the hub shows |
|---|---|---|
| `eval:` block | `eval-gate-report.json` | the report's score, in the existing states (measured gain, no measured gain, regressed, failed) |
| `eval:` block | none | unscored, with the reason "declared, not yet measured" |
| no block | any | unchanged: gate report, then the `catalog-info.yaml` annotation, then `eval-score.json` |

A declared package with no gate report still falls back to a catalogue
annotation or `eval-score.json` when one exists, so declaring a block never
removes a score the package already had. Without any score the package is
unscored and not offered for installation, the same as before.

A block that is not a non-empty mapping (an empty `eval:`, a list or a string)
is ignored and reported as a warning in the provider log. It never stops the
repository publishing.

The report is always read from `eval-gate-report.json` beside `apm.yml`. A
`report:` key inside the block does not change where the hub looks.
