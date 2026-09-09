# Product

## Register

product

## Users

Two people, in the same room, wanting different things.

**The developer.** A platform or application engineer inside a large regulated
organisation. They are mid-task in an IDE, they have heard there is a testing
skill worth having, and they want to know three things fast: what it does,
whether anyone has actually measured it, and the one line to run. They will
give this page thirty seconds before going back to asking a colleague on Slack.

**The sponsor.** An engineering leader who already runs a hosted Backstage and
is deciding whether agent assets get governed the way services are. They are
not going to install anything. They are looking for evidence that provenance
and evaluation are enforced rather than described, and they will notice the
moment the interface starts asserting quality instead of showing it.

The job: turn "somebody in the estate wrote a good skill" into something a
stranger can find, judge and install without asking a human.

## Product Purpose

Backstage is already where this organisation looks up who owns what. The hub
extends that to agent assets: skills, agents, hooks, prompts, eval suites, MCP
servers and packs. A repository opts in with one file, its assets appear, and
each one carries where it came from, which commit it is pinned to, and what it
scored.

Success is the install gesture feeling like npm: search, read, copy one line.
Failure is a catalogue that lists things nobody can evaluate.

## Brand Personality

Exact, unhurried, unembellished.

It should read as instrumentation rather than marketing. The interface states
what is true, including when the truth is "nobody has measured this", and it
never dresses an absence up as a feature. Confidence comes from specificity:
a commit sha, a metric against its baseline, the date it was recorded.

## Anti-references

- **A marketplace.** No hero, no featured carousel, no star ratings, no badge
  wall. This is a register, not a storefront.
- **Stock Backstage as shipped.** The Spotify teal, the illustrated 404, the
  "My Company" placeholders. A sponsor who runs Backstage will recognise a
  demo left at its defaults, and read the whole thing as unfinished.
- **The dashboard reflex.** Big numbers in cards across the top. Nothing here
  is a KPI; the counts belong next to the thing they count.
- **Quality theatre.** Green ticks, shields, "verified" chips that resolve to
  nothing. Every quality signal on this surface must be traceable to a report.

## Design Principles

1. **The score is the gate, not a decoration.** Where an asset is unscored,
   the interface refuses the install and says why. Colour, emphasis and
   space are spent on the verdict before anything else.
2. **Show the evidence, not the assertion.** A commit sha, a metric with its
   baseline, a link to the run. If a claim cannot be traced, it does not
   appear.
3. **Absence is a state worth designing.** Unscored, unowned, no body, nothing
   matching a filter. Each gets a real treatment, not a blank.
4. **The chrome is achromatic.** Colour carries state and nothing else, so a
   verdict is never competing with decoration for the same signal.
5. **It belongs inside their portal.** Backstage's layout, navigation and
   component vocabulary are kept. What changes is the palette, the density and
   the copy, so it reads as a first-party product rather than someone else's
   demo.

## Accessibility & Inclusion

WCAG 2.2 AA, verified rather than asserted.

- Body text at or above 4.5:1, large text at or above 3:1, in both themes.
- Every control reachable and operable by keyboard, with a visible focus ring
  that is not the browser default.
- State is never carried by colour alone: the verdict badge pairs its colour
  with a word, and the unscored badge with a different border treatment.
- `prefers-reduced-motion` honoured; no transition is load-bearing.
- Light and dark both first-class. Light is the default, because the primary
  act is reading a document and the primary demo is a shared screen.
