# PRD — `skillevel bench --vs <ref>`: did this edit actually improve the skill?

Status: **shipped** (v2.2 — see [`DESIGN.md`](../DESIGN.md)). Kept as the
design record; the "How it works" section landed as written, on top of
v2.1's isolation primitive.

## Problem

`skillevel bench` already answers "does this skill help vs. no skill at all" —
`with` arm runs with the skill available, `without` arm blocks all skills
(`--disallowedTools Skill`), and the report is a lift in percentage points.

That is not the question an author has mid-edit. The real question, every
time a `SKILL.md` changes, is:

> **Is the new version better than the version it's replacing — or did I
> just make it worse while chasing one case?**

Today there is no first-class way to answer this. The only workaround is
manual: run `bench --json before.json`, edit the skill, run
`bench --json after.json` again, and diff `withRate` by hand. That works but
has three real costs:

1. **No single command / no CI gate.** Nothing like `--min-lift` exists for
   "vs. the previous version," so a regression can't fail a build the way a
   vs.-baseline regression can.
2. **Drift between the two runs.** The two `bench` invocations are not
   interleaved — model updates, service load, or plain trial variance can
   shift results between them, and the diff conflates "the edit changed
   things" with "the day changed things."
3. **The old version has to still be physically installed** to bench it —
   awkward mid-edit, since editing a file overwrites the only artifact needed
   to compare against.

## Goal

One command reports the delta between two versions of the same skill's
`SKILL.md`, run in the same batch, against the same cases:

```
$ skillevel bench code-review --vs main

code-review  ./code-review.eval.yaml   (new: working copy, old: main)
  case                    old        new      delta
  happy-review-diff        1/3        3/3     +67pp
  happy-2                  2/3        2/3       0pp
  neg-explain-format     — skipped (needs should_trigger: true + match/absent/judge)

▲ improvement: +34pp   (44% → 78%)   2 compared   $1.32
```

- delta ≫ 0 → the edit is a real improvement, ship it.
- delta ≈ 0 → the edit didn't move quality (may still be worth it for
  other reasons — trigger precision, token cost — but say so, don't imply
  quality regressed).
- delta < 0 → the edit made a benched case worse; the report should say
  which case, so the author can see the regression before shipping, not
  after.

This is the "improvement report" use case: an author (or CI) runs one
command after editing a skill and gets a yes/no/how-much answer, instead of
inferring it from two separate `bench` runs.

## Non-goals

- **Not a new case format.** `--vs` reuses whatever cases the suite already
  has — same "benchable = `should_trigger: true` + output check" rule as
  today's `bench`.
- **Not a replacement for `bench`'s existing with/without arm.** Both modes
  stay: "vs. no skill" (is this skill worth having at all) and "vs. previous
  version" (did this edit help) answer different questions. `--vs` is an
  additional flag on the same command, not a new command.
- **Not multi-file history.** `--vs` compares the skill's own `SKILL.md`
  (and, if present, its `references/`) between two refs — not the whole
  repo, not other files the skill happens to read.
- **Not a general git-diff tool.** No rendering of the prose diff itself;
  that's `git diff`. `skillevel` reports behavioral delta only.

## User stories

1. **Mid-edit sanity check.** "I just changed the trigger description and
   tightened the rubric — did I break anything?" → `bench sql --vs HEAD` (or
   no ref = last commit) before committing.
2. **PR review gate.** A CI job on skill-touching PRs runs
   `bench <skill> --vs origin/main --min-improvement 0` and fails the build
   if the edit regresses any benched case beyond noise.
3. **Retrospective on a shipped change.** "Was that skill rewrite from last
   month actually worth it?" → `bench <skill> --vs v1.2.0` (a tag) or
   `--vs <commit-sha>`.
4. **TDD-style capture-then-fix.** A production case is noticed to misfire or
   answer badly. Rather than fixing the skill first and hoping the fix holds,
   the author captures the failing prompt as a case _before_ touching
   `SKILL.md` (red), edits the skill, then runs `--vs HEAD` to confirm the
   new version passes the just-captured case without regressing the existing
   ones (green). See "Related workflow" below — this is a natural companion
   to `--vs` but is its own, smaller piece of surface.

### Related workflow — capture-then-fix (not in this PRD's scope, noted for sequencing)

`--vs` answers "is the new version better," which is exactly the check this
workflow needs at its "green" step — but getting to a well-formed case in
the first place is a separate gap. Today, capturing a real failure means
hand-writing a case into the suite's YAML and manually confirming it fails
before editing (nothing distinguishes "case I haven't tried yet" from "case
I've confirmed is currently red").

A `skillevel capture <skill> "<prompt>"` command would close that gap: scaffold
the case from the live prompt, run it once against the current skill to
confirm it's actually red (rather than trusting the author's assumption),
and mark it in the YAML as a known-failing regression case (distinct from
`new`'s TODO placeholders, which are unwritten rather than confirmed-failing).
Paired with `--vs`, the loop becomes: `capture` (red, proven) → edit
`SKILL.md` → `bench <skill> --vs HEAD` (green, and no other case broke in the
process).

Left as a separate, follow-on PRD rather than folded into `--vs` here — the
two are independently useful (`--vs` has value with zero captured cases,
`capture` has value with zero old-version comparisons) and bundling them
would make `--vs` depend on new case-file semantics (a "confirmed-red" case
state) it doesn't otherwise need.

## CLI design

```
skillevel bench [target] --vs <ref>
```

- `<ref>` is anything `git show <ref>:<path>` accepts — branch, tag, commit
  SHA, `HEAD~1`. No default; omitting `--vs` keeps today's behavior
  (with-skill vs. no-skill).
- `--min-improvement <pp>` — CI gate, same shape as `bench`'s existing
  `--min-lift`. Exits non-zero when delta drops below the threshold (default:
  no gate, matches `--min-lift`'s current opt-in behavior).
- `--json <file>` — carries `old`/`new` pass counts per case, same place
  `withPassed`/`withoutPassed` live today.
- Everything else (`-t`, `-m`, `-c`, `--trials`) carries over unchanged.
- `--vs` requires the target to resolve to a path inside a git working tree
  (the "old" side is read via `git show`); outside a repo, fail with a clear
  error rather than silently falling back to the no-skill baseline.

## How it works

Reuses two things that already exist rather than inventing new plumbing:

1. **Isolated `cwd` per arm.** The agent runner already accepts
   `options.cwd` (`AgentRunOptions` in `src/agent/agent-runner.ts`) —
   DESIGN.md's `--skill-dir` papercut (#2 in the dogfooding notes) wants
   this for reproducible working-copy runs anyway.
   `--vs` needs the same primitive: materialize the **old** version of
   `SKILL.md` (and `references/` if present) into a throwaway temp dir laid
   out as `.claude/skills/<name>/SKILL.md`, then run that arm with
   `cwd: tmpDirOld`. The **new** arm runs with the working copy as it does
   today (`cwd` unset / repo root) — no working-copy checkout needed since
   it's already on disk.
2. **The existing bench arm/grading loop.** `armJob` in `src/core/bench-runner.ts`
   already runs a case twice and grades both with `evaluateOutputChecks`
   (no trigger check — confirmed content-only, see `evaluateOutputChecks` in `src/core/checks.ts`).
   `--vs` mode swaps what varies between the two calls: today it's
   `disallowSkills: true/false` on the _same_ installed skill; in `--vs`
   mode it's `cwd: tmpDirOld` vs. `cwd: undefined` (or the working copy's own
   dir) on _different SKILL.md contents_, with `disallowSkills` unset on
   both arms (both must be free to trigger).
3. **Cleanup.** Temp dir is per-run, removed after the batch completes (or
   left with a `--keep-tmp` escape hatch for debugging — matches the spirit
   of "everything offline and deterministic" already in `lint`/`fmt`).

Materializing the old side needs:

- `git show <ref>:<relative-path-to-SKILL.md>` for the file itself.
- The same for each file under `references/` the current `SKILL.md`
  references, if the directory existed at `<ref>` (best-effort — a
  `references/` file added in the same edit as the SKILL.md change won't
  exist at the old ref, which is correct: that's part of what changed).
- If `<ref>` predates the skill entirely (path didn't exist), fail per-suite
  with a clear message ("`<skill>` did not exist at `<ref>`") rather than
  comparing against nothing.

## Report format

Terminal (mirrors today's `bench` table, `old`/`new` replacing
`with`/`without`):

```
<skill>  <file>   (new: working copy, old: <ref>)
  case                    old        new      delta
  <id>                   X/N        Y/N     ±ZZpp
  ...

▲/▼ improvement: ±NNpp   (A% → B%)   K compared · M skipped   $cost
```

- Skipped-case reason stays identical to `bench` today (no output checks, or
  negative case — nothing to compare).
- A case that regresses (`new < old`) should render distinctly (e.g. red
  `▼`) rather than just a smaller positive number, so a regression is
  visually impossible to miss scanning the grid.

JSON (`--json`): same `BenchSuiteResult`/`BenchCaseResult` shape as today,
with `withPassed`/`withoutPassed` renamed at the type level to generic
`aPassed`/`bPassed` (or kept as-is with `mode: "vs-baseline" | "vs-ref"` on
the result so existing consumers of the without-skill mode aren't broken) —
exact naming is an implementation decision, not a product one.

## Success metrics

- An author can go from "I edited a skill" to "I know if it's better" in one
  command, without hand-diffing two JSON files.
- `--min-improvement` is usable as a CI gate on skill PRs the same way
  `--min-lift` and `--ci` already gate triggering/baseline-lift regressions.

## Open questions

- **Trial budget.** `--vs` doubles cost the same way `bench` already does
  (two full runs + judge calls per case) — should `--trials` default lower
  when both `--vs` and `judge` checks are in play, given this is meant to be
  a routine mid-edit check, not a one-off audit?
- **Uncommitted "old" state.** If the working tree has staged-but-uncommitted
  changes to `SKILL.md`, should `--vs` (no ref) default to `HEAD` (last
  commit) or the index? Proposal: default to `HEAD` — "vs. what's on disk
  right now for anyone else who pulls" is the more useful default than
  "vs. the index," and matches `git diff HEAD`'s framing.
- **References-only edits.** If only a `references/` file changed (not
  `SKILL.md` itself), is that still worth benching? Likely yes — the skill's
  behavior can change without its frontmatter/body changing — but it means
  the "old" materialization step must diff more than one file's mtime to
  decide whether a re-bench is warranted for `--ci` short-circuiting
  (out of scope for v1; v1 always runs when `--vs` is passed, no
  skip-if-unchanged heuristic).
- **Relationship to `--skill-dir` (papercut #2 in DESIGN.md).** Both need the
  same "point `claude -p` at an isolated `.claude/skills/<name>` dir via
  `cwd`" primitive. Worth landing `--skill-dir` first as the general
  isolation mechanism, then building `--vs`'s old-side materialization on
  top of it, rather than solving isolation twice.
