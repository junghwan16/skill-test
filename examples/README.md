# examples

Two **self-contained skill packages** laid out exactly like a real project
keeps them — the `SKILL.md` and its eval suite side by side — plus the runner
self-check. Everything here was built and verified by dogfooding skillevel's
own toolchain (`lint` / `fmt` / `validate` / run / `bench`).

```
examples/
  review-pr/
    SKILL.md                 # a real, self-contained skill
    review-pr.eval.yaml      # its eval suite, shipped alongside it
  commit-style/
    SKILL.md
    commit-style.eval.yaml
  smoke.eval.yaml            # runner self-check — no skill at all
```

## The two skills

**`review-pr`** — reviews the diff of a branch/PR along Correctness / Style /
Tests. It's a _repo-context_ skill: it only fires when there's actually a diff
to review, so its suite sets **`cwd: ../..`** to run against the skillevel repo
root (a real git repo). This is the per-suite working-directory knob — without
it, the happy cases would report `fired: none` in an empty directory.

**`commit-style`** — writes a Conventional Commits message from staged or
described changes.

The two pin **each other's** routing boundary: `review-pr`'s suite has a case
that must route to `commit-style` ("write a commit message"), and
`commit-style`'s suite has the mirror ("review my branch") — a fully
self-contained `expect_skill` collision, no external skills needed.

> Heads-up: `review-pr`'s suite goes fully green only when no _other_
> diff-review skill is installed. If you also have a skill like `code-review`
> (whose description overlaps — "review a branch, a PR, since X"), it can win
> the routing and show up as `fired: code-review`. That over-triggering
> collision is exactly what skillevel is for surfacing — see DESIGN.md.

## Running them

skillevel tests the **installed** skill (what `claude -p` discovers). These
live in the repo, so install them first — symlink each into `~/.claude/skills`:

```bash
ln -s "$PWD/examples/review-pr"    ~/.claude/skills/review-pr
ln -s "$PWD/examples/commit-style" ~/.claude/skills/commit-style
```

Then, from the repo root:

```bash
# offline — costs nothing, catches schema errors + previews run count:
npx skillevel validate examples/review-pr/review-pr.eval.yaml

# a real run (bound the cost with --trials):
npx skillevel review-pr --trials 1
npx skillevel bench review-pr --trials 1     # does the skill actually help?

# always runnable, no skill needed — cheapest end-to-end check:
npx skillevel examples/smoke.eval.yaml
```

The authoring toolchain works on the in-repo copies directly (local skills win
over installed ones), no symlink required:

```bash
npx skillevel lint examples/review-pr examples/commit-style
npx skillevel fmt  --check examples/review-pr examples/commit-style
```
