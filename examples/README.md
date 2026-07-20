# examples

Two **self-contained skill packages** laid out exactly like a real project
keeps them — the `SKILL.md` and its eval suite side by side — plus the runner
self-check. Everything here was built and verified by dogfooding skilltree's
own toolchain (`lint` / `fmt` / `validate` / run / `bench`).

```
examples/
  review-pr/
    SKILL.md                 # a real, self-contained skill
    review-pr.eval.yaml      # its eval suite, shipped alongside it
  sql/
    SKILL.md
    sql.eval.yaml
  smoke.eval.yaml            # runner self-check — no skill at all
```

## The two skills

**`review-pr`** — reviews the diff of a branch/PR along Correctness / Style /
Tests. It's a _repo-context_ skill: it only fires when there's actually a diff
to review, so its suite sets **`cwd: ../..`** to run against the skilltree repo
root (a real git repo). This is the per-suite working-directory knob — without
it, the happy cases would report `fired: none` in an empty directory.

**`sql`** — writes a query against our analytics warehouse (a made-up ad-serving
star schema) from a plain-language ask. It's the mirror image: a _pure-text_
skill with **no repo state**, so its happy cases need no `cwd`. Its point is
**lift** — base Claude invents plausible table names (`impressions`, `revenue`),
so it fails the schema checks; only the skill knows the real `fact_impression`
table, the micro-USD money column, and the `dt` partition rule. `bench sql`
turns that gap into a number (a real **+100pp** on the primary case).

The two pin **each other's** routing boundary: `review-pr`'s suite has a case
that must route to `sql` ("write a query"), and `sql`'s suite has the mirror
("review my branch") — a fully self-contained `expect_skill` collision, no
external skills needed. `sql`'s routing case borrows `review-pr`'s trick with a
per-case **`cwd: ../..`**, since the sibling only fires where there's a diff.

> Heads-up: `review-pr`'s suite goes fully green only when no _other_
> diff-review skill is installed. If you also have a skill like `code-review`
> (whose description overlaps — "review a branch, a PR, since X"), it can win
> the routing and show up as `fired: code-review`. That over-triggering
> collision is exactly what skilltree is for surfacing — see DESIGN.md.

## Running them

skilltree tests the **installed** skill (what `claude -p` discovers). These
live in the repo, so install them first — symlink each into `~/.claude/skills`:

```bash
ln -s "$PWD/examples/review-pr" ~/.claude/skills/review-pr
ln -s "$PWD/examples/sql"       ~/.claude/skills/sql
```

Then, from the repo root:

```bash
# offline — costs nothing, catches schema errors + previews run count:
npx skilltree validate examples/sql/sql.eval.yaml

# a real run (bound the cost with --trials):
npx skilltree sql --trials 1
npx skilltree bench sql --trials 1     # does the skill actually help?

# always runnable, no skill needed — cheapest end-to-end check:
npx skilltree examples/smoke.eval.yaml
```

The authoring toolchain works on the in-repo copies directly (local skills win
over installed ones), no symlink required:

```bash
npx skilltree lint examples/review-pr examples/sql
npx skilltree fmt  --check examples/review-pr examples/sql
```
