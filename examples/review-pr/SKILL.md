---
name: review-pr
description: Review the diff of a branch or PR before it merges — read the changes since a fixed point (branch, tag, commit, or merge-base) and report issues grouped as Correctness, Style, and Tests. Use when the user wants to review a branch, a pull request, or work-in-progress changes, or asks to "review since X".
---

# review-pr — review a diff before it merges

A focused review of the changes since a fixed reference point. One pass, one
report — no sub-agents, no repo-wide audit. If there is nothing to review (no
diff, a bad ref), say so instead of inventing findings.

## Fix the comparison first

Resolve the fixed point the user named (a branch like `main`, a tag, a commit,
or `HEAD~N`). Default to the merge-base against the default branch when they
just say "my branch" or "this PR". Capture the diff once:

```bash
git diff <fixed-point>...HEAD      # three-dot: against the merge-base
git log  <fixed-point>..HEAD --oneline
```

Confirm the ref resolves and the diff is non-empty before reviewing. An empty
diff or unknown ref is a stop, not a finding.

## Report along three axes

Group findings under these headings, most serious first. Skip a heading with
nothing under it rather than padding it.

- **Correctness** — logic errors, unhandled cases, broken contracts, anything
  that changes behaviour in a way the change did not intend.
- **Style** — naming, dead code, and drift from the conventions already
  visible in the surrounding files. Match the repo; don't impose a new style.
- **Tests** — new/changed behaviour that ships without a test, and tests that
  assert the wrong thing.

For each finding give `file:line`, one sentence on what's wrong, and the
smallest fix. End with a one-line verdict: ready to merge, or the blocking items.

## Stay in your lane

Review the diff as written. Don't propose unrelated refactors, don't rewrite
the branch, and don't run or push anything — this is a read-and-report skill.
Diagnosing a specific failing test belongs to a debugging skill; drafting
release notes belongs to a changelog skill.
