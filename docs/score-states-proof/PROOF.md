# Score states proof

The catalogue run locally (`yarn start`, guest sign-in) in a real Chromium
against five packs. The entities were built by the hub's own `buildEntities`
from gate reports, then loaded as a file location, because no GitHub access
was available in this environment.

| Screenshot | State | Source of the report |
|---|---|---|
| `2-no-measured-gain-REAL-REPORT.png` | pass, no significant improvement | **Real**: `packages/test-writer-pack/eval-gate-report.json` from ainb-toolkit branch `f/test-writer-pack`, verbatim (`subject.commit` bd06dab, 95% interval -0.0102 to 0.0105) |
| `1-measured-gain-FIXTURE.png` | pass and significant improvement | **Fixture**: the real report with `significant_improvement` true and an interval of 0.021 to 0.084 |
| `3-regressed-FIXTURE.png` | verdict regression | **Fixture**: the real report with verdict `regression` |
| `4-unscored-FIXTURE.png` | no report | **Fixture**: a pack with no `eval-gate-report.json` |
| `5-stale-score-FIXTURE.png` | no-gain, measured at another commit | **Fixture**: the real report on a pack pinned to a different commit |
| `6-gain-claimed-by-eval-score-json-FIXTURE.png` | a gain claimed in a hand-written eval-score.json, capped at no measured gain | **Fixture**: an `eval-score.json` stating a significant improvement, no gate report |
| `browse-all-states.png` | all six in the list | as above |

What each shows:

- Measured gain: badge "measured gain" with the change over the gate's baseline and its interval, when the report gives a confidence, Install offered. The browse list shows one Score facet and one header count per state.
- No measured gain: dashed badge "no measured gain over the gate's baseline",
  Install offered with the same sentence as a visible warning.
- Regressed: badge "regressed", no harness picker and no command. The provider publishes no command for it either, so the block is not only in the page.
- Unscored: badge "unscored", no harness picker and no command.
- Stale: the score stays visible, and `scored at bd06dab, pinned f4f4f4f`
  sits beside the badge. Install additionally asks for acknowledgement.

Report shape note: in the real file the confidence interval and
`significant_improvement` flag are on the aggregate `stats` block, not on each
signal. Per-signal entries carry only means and a delta. The hub reads `stats`.

Copy follows what a report states. The baseline is called "the gate's
baseline" unless the report says it was no skill at all, and an interval is
shown only at a confidence the report gives. Only a gate report can show a
measured gain; the sixth screenshot shows a claim from anywhere else capped,
with its source named in the Eval score card.
