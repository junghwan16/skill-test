# 1. `bench --vs <ref>` — old-vs-new skill comparison

Status: **Accepted** — shipped in v2.2 (see [`DESIGN.md`](../../DESIGN.md)).
The "Decision" below landed as written, on top of v2.1's isolation primitive.

## Context

`skillevel bench` answers "does this skill help vs. no skill at all" — the
`with` arm runs with the skill available, the `without` arm blocks all skills
(`--disallowedTools Skill`), and the report is a lift in percentage points.

That is not the question an author has mid-edit. Every time a `SKILL.md`
changes, the real question is:

> **Is the new version better than the version it's replacing — or did I just
> make it worse while chasing one case?**

There was no first-class way to answer this. The only workaround was manual —
`bench --json before.json`, edit the skill, `bench --json after.json`, then
diff `withRate` by hand. That worked but had three real costs:

1. **No single command / no CI gate.** Nothing like `--min-lift` existed for
   "vs. the previous version," so a regression couldn't fail a build the way a
   vs.-baseline regression can.
2. **Drift between the two runs.** The two `bench` invocations aren't
   interleaved — model updates, service load, or plain trial variance shift
   results between them, conflating "the edit changed things" with "the day
   changed things."
3. **The old version has to still be physically installed** to bench it —
   awkward mid-edit, since editing a file overwrites the only artifact needed
   to compare against.

## Decision

Add a `--vs <ref>` flag to `bench` that reports the delta between two versions
of the same skill's `SKILL.md`, run in the same batch, against the same cases:

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
- delta ≈ 0 → the edit didn't move quality (may still be worth it for trigger
  precision or token cost — say so, don't imply quality regressed).
- delta < 0 → the edit made a benched case worse; the report names the case so
  the author sees the regression before shipping, not after.

### CLI surface

```
skillevel bench [target] --vs <ref>
```

- `<ref>` is anything `git show <ref>:<path>` accepts — branch, tag, commit
  SHA, `HEAD~1`. No default; omitting `--vs` keeps the with-skill vs. no-skill
  behavior.
- `--min-improvement <pp>` — CI gate, same shape as `bench`'s `--min-lift`.
  Exits non-zero when delta drops below the threshold (default: no gate).
- `--json <file>` — carries `old`/`new` pass counts per case.
- `-t`, `-m`, `-c`, `--trials` carry over unchanged.
- `--vs` requires the target to resolve to a path inside a git working tree
  (the "old" side is read via `git show`); outside a repo, fail with a clear
  error rather than silently falling back to the no-skill baseline.

### How it works

Reuses two existing primitives rather than inventing new plumbing:

1. **Isolated `cwd` per arm.** The agent runner already accepts `options.cwd`
   (`AgentRunOptions` in `src/agent/agent-runner.ts`). `--vs` materializes the
   **old** version of `SKILL.md` (and `references/` if present) into a
   throwaway temp dir laid out as `.claude/skills/<name>/SKILL.md`, then runs
   that arm with `cwd: tmpDirOld`. The **new** arm runs with the working copy
   as it does today.
2. **The existing bench arm/grading loop.** `armJob` in
   `src/core/bench-runner.ts` already runs a case twice and grades both with
   `evaluateOutputChecks` (content-only, no trigger check). `--vs` swaps what
   varies between the two calls: instead of `disallowSkills: true/false` on the
   _same_ installed skill, it's `cwd: tmpDirOld` vs. the working copy on
   _different `SKILL.md` contents_, with `disallowSkills` unset on both arms.
3. **Cleanup.** Temp dir is per-run, removed after the batch (with a
   `--keep-tmp` escape hatch for debugging).

Materializing the old side uses `git show <ref>:<path>` for `SKILL.md` and each
referenced file under `references/` that existed at `<ref>` (best-effort — a
`references/` file added in the same edit won't exist at the old ref, which is
correct). If `<ref>` predates the skill entirely, fail per-suite with a clear
message rather than comparing against nothing.

## Consequences

### Non-goals

- **Not a new case format.** `--vs` reuses whatever cases the suite has — same
  "benchable = `should_trigger: true` + output check" rule as today's `bench`.
- **Not a replacement for the with/without arm.** Both modes stay; "vs. no
  skill" and "vs. previous version" answer different questions. `--vs` is an
  additional flag, not a new command.
- **Not multi-file history.** `--vs` compares the skill's own `SKILL.md` (and
  its `references/`) between two refs — not the whole repo.
- **Not a general git-diff tool.** No prose-diff rendering; `skillevel` reports
  behavioral delta only.

### Report format

The terminal table mirrors today's `bench`, with `old`/`new` replacing
`with`/`without`. A regressing case (`new < old`) renders distinctly (e.g. red
`▼`) so a regression is visually impossible to miss. JSON keeps the same
`BenchSuiteResult`/`BenchCaseResult` shape, distinguishing modes at the type
level (exact naming was an implementation decision).

### Open questions (recorded at decision time)

- **Trial budget.** `--vs` doubles cost; should `--trials` default lower when
  `--vs` and `judge` checks are both in play?
- **Uncommitted "old" state.** With no ref, `--vs` defaults to `HEAD` (matches
  `git diff HEAD`'s framing) rather than the index.
- **References-only edits.** A `references/`-only change can still change
  behavior; v1 always runs when `--vs` is passed (no skip-if-unchanged
  heuristic).
- **Relationship to `--skill-dir`.** Both need the same isolated-`cwd`
  primitive; `--skill-dir` was landed first as the general isolation mechanism,
  then `--vs`'s old-side materialization was built on top of it.

### Related follow-on — capture-then-fix (out of scope here)

`--vs` supplies the "green" check for a TDD-style loop: capture a failing
prompt as a case (red, proven), edit `SKILL.md`, then `bench --vs HEAD` (green,
nothing else broke). Capturing a well-formed, confirmed-red case is a separate
gap — a future `skillevel capture <skill> "<prompt>"` — left as its own piece
of surface because the two are independently useful and bundling them would
make `--vs` depend on case-file semantics it doesn't otherwise need.
