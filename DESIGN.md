# skillevel — design

A test runner for **Claude Code skills**. Think `vitest`, but a "test" is a
prompt and the thing under test is whether a skill fires (and behaves) the way
its author intended.

## Why

Skills are prompt-triggered and non-deterministic. Before shipping or editing
one, two things matter:

1. **Triggering** — does it fire on the prompts it should, and stay out of the
   near-misses it shouldn't (over/under-firing)?
2. (later) **Task quality** — does the skill actually make the output better?

`skillevel` v1 nails **#1** — cheap, fast, the highest-frequency need. v2
ships **#2** as `skillevel bench`: the same cases, run with and without the
skill, graded, reported as lift.

## Positioning

- A **standalone `npx` CLI** — not a Claude Code skill, not tied to one repo.
- It **adopts the community `evals/cases.yaml` schema** (from the `skill-eval`
  skill) rather than inventing one. Cases stay portable; skillevel is just the
  most ergonomic runner + scaffolder for them.
- Mental model: **vitest for skills**. Auto-discovery, `trials` = built-in
  flake handling, `--ci` = regression gate.

## Commands

```
skillevel                    # discover & run every eval (**/*.eval.yaml, evals/cases.yaml)
skillevel sql                # filter to a skill or a file
skillevel -t "negative"      # filter by case id/substring
skillevel --ci               # non-zero exit on any regression / unwritten case
skillevel --json out.json    # machine-readable results alongside the grid
skillevel bench sql          # A/B with vs without the skill; report the lift
skillevel new sql            # scaffold what's missing: sql/SKILL.md and/or sql.eval.yaml
skillevel lint [target...]   # validate SKILL.md files (errors) + guidance heuristics (warnings)
skillevel fmt [--check]      # conservative SKILL.md frontmatter/whitespace normalizer
```

Deliberately **not** in the surface (cut for real-repo ergonomics): `--watch`
(every re-run costs real dollars and minutes — an accidental save mid-edit
should not start a run) and the `dot`/`junit` reporters (the grid serves
humans, `--json` serves machines; nothing consumed the others).

## Case format (adopted from skill-eval)

```yaml
skill: sql # leaf name; must match the Skill tool's skill name
trials: 5 # runs per case (variance); per-case override allowed
# model: sonnet          # optional
# triggerThreshold: 0.8  # case is green if pass-rate >= this (default 0.8)
cases:
  - id: happy-1
    prompt: "..."
    should_trigger: true
    expect: # optional extra asserts, on top of the trigger check
      - triggered
      - match: "SELECT" # case-insensitive regex in the response
      - absent: "DELETE" # regex must NOT appear
      # - judge: "is the query read-only and correctly scoped?"  # LLM-graded
  - id: neg-1
    prompt: "..."
    should_trigger: false
    expect: [not_triggered]
```

- `should_trigger` is the **primary check**: did the target skill fire?
- `expect_skill: <name>|none` is the routing form of the primary check: the
  named skill must win. Naming the suite's own skill ≡ `should_trigger: true`;
  naming a sibling asserts the collision lands there (sibling fires, target
  stays out); `none` asserts no skill fires. The loader derives
  `should_trigger` from it, so both forms share the runner machinery.
- `triggered` / `not_triggered` in `expect` are redundant shorthands (validated
  against `should_trigger`); `match` / `absent` / `judge` add output checks.
- A **placeholder prompt** (contains `<...>`) marks the case as _unwritten_ — it
  is reported as TODO and fails `--ci`, so `new` output can't silently pass.

## `new` — one on-ramp; scaffold, don't generate

There is a single scaffolding command. `skillevel new <skill>` creates
whatever the skill is missing and skips what already exists:

- **`<skill>/SKILL.md`** — only when no skill by that name exists (locally or
  installed). A starter whose placeholders are honest TODOs and whose
  authoring guidance (triggering description, 500-line limit, progressive
  disclosure) rides along as a deletable comment.
- **`<skill>.eval.yaml`** — the cases file. It reads the target `SKILL.md`
  (dev copy in cwd if present, else installed), pre-fills `skill:`, writes
  example happy + near-miss-negative cases as clearly-marked placeholders with
  the authoring principles inline, and pulls the skill's own **trigger
  keywords verbatim** into a comment as a hint.

(An earlier split — `init` for the cases file, `new` for the skill — asked
users to remember which creation verb made which artifact; one idempotent
command removes the distinction.)

Everything is **offline and deterministic** — it does NOT ask an LLM to invent
cases or content (auto-generated cases plant plausible-but-wrong tests). The
human writes the real cases — ideally from real usage/production traces.

## Authoring toolchain — `lint` / `fmt`

The same philosophy: **offline and deterministic**, templates and guidance
only — never LLM-invented content.

- `lint` splits its findings by authority: **errors** are the packaging /
  validation rules (ported from skill-creator's `quick_validate.py` — a skill
  that fails them won't install cleanly); **warnings** are authoring guidance
  (unwritten descriptions, leftover placeholders, broken `references/` paths,
  over-length bodies) — judgement calls, so they never fail the exit code.
- `fmt` is deliberately conservative: it normalises frontmatter key order and
  whitespace, and when it can't parse the frontmatter it returns the file
  untouched — the linter reports the problem; the formatter never destroys
  content.

## Run mechanism

For each case × trial, shell out to:

```
claude -p "<prompt>" --output-format stream-json --verbose [--model M] [--max-turns N]
```

Parse the NDJSON stream: a `tool_use` block named `Skill` carries the fired
skill in `input.skill`; the terminating `result` event carries the final text
and `total_cost_usd`. (Schema verified on Claude Code 2.1.x.)

**Early-exit** (cost saver, borrowed from skill-creator's `run_eval.py`): when a
case has only trigger checks,

- `should_trigger: true` → kill the process the moment the target skill fires
  (fast pass);
- `should_trigger: false` → kill the moment _any_ skill fires (fast fail);
  otherwise run to completion (needed for `match`/`absent`/`judge`), with a low
  `--max-turns` to bound negatives.

## Scoring

- A **trial** passes if the trigger direction matches `should_trigger` and every
  `expect` assert passes.
- A **case**'s score is `passes / trials`; it is green when
  `>= triggerThreshold` (default 0.8), so a single flake doesn't fail it.
- `--ci` exits non-zero if any case is below threshold or unwritten.

## Which version of the skill is tested (limitation)

Runs test whatever `claude -p` **already discovers** (installed
`~/.claude/skills`, project `.claude/skills`, plugins). To test a working-copy
edit, install/symlink it. **Roadmap:** `--skill-dir <path>` sets up an isolated
temp project (`.claude/skills/<name>` + `--bare`) so you can eval an uncommitted
SKILL.md reproducibly.

## Non-goals

- Multi-harness (Cursor/Codex/Gemini) — `claude -p` only.
- HTML report — terminal + JSON first.

---

# v2 — task-quality A/B (does the skill actually help?) — SHIPPED

v1 answers _does it trigger_. v2 answers _does it improve the output_ — the
question that decides whether a skill is worth its tokens, and whether an edit
made it better. This is the ablation `skill-eval` describes and the A/B loop the
official `skill-creator` runs, packaged as one command: `skillevel bench`.

## The idea

For each case, run the **same prompt twice** — once with the skill available,
once without — grade both outputs, and report the **lift**:

```
$ skillevel bench sql

sql  ./sql.eval.yaml
  case                    with   without    lift
  aggregate-revenue        3/3       1/3   +67pp
  safe-delete              3/3       3/3     0pp     ← model already handles this
  ...

▲ skill lift: +34pp   (48% → 82%)   4 benched   $1.10
```

- lift ≫ 0 → the skill earns its place.
- lift ≈ 0 across the board → **retire candidate** (the model already does it);
  keep the cases as a regression guard, per `skill-eval`.

## Cases

No new file format — a v2 case is a v1 case whose `expect` carries **output**
assertions instead of (or on top of) the trigger check:

```yaml
- id: aggregate-revenue
  prompt: "What was revenue by month last quarter?"
  should_trigger: true
  expect:
    - judge: "Produces a correct GROUP BY month aggregate, read-only"
    - match: "GROUP BY"
```

`judge` is graded PASS/FAIL by an LLM (burden of proof on the assertion, no
partial credit). Benchable = `should_trigger: true` **and** at least one output
check: trigger-only cases have nothing to compare, and a "must not fire" case
is identical in both arms — both are reported as skipped.

## The "without skill" arm — the hard part, honestly

The shipped baseline is the **blunt** one: `--disallowedTools Skill` blocks
_all_ skills. Cheap and reliable, but it measures "this skill vs no skills",
not "vs this one skill removed" — fine when the case wouldn't pull in a
sibling anyway. **Roadmap (v2.1):** an isolated temp project whose
`.claude/skills/` contains everything _except_ the skill under test, for true
per-skill ablation.

Both arms run **interleaved in the same batch** (as `skill-creator` does) so
time-of-day and model drift hit both equally, with no early exit — bench needs
the full output.

## CLI surface

```
skillevel bench [target]           # with vs without, report lift
  --trials <n>                     # per arm; defaults to 3 (each case = 2× runs + grading)
  --min-lift <pp>                  # CI gate: exit non-zero when lift drops below this
  --json <file>                    # full A/B results for machines
```

Discovery, `-t` filter, `-m`/`-c`, and the suite `model` carry over from the
eval runner unchanged. `--min-lift` is how a skill edit that quietly regresses
quality fails the build.

## Roadmap / open questions

- **Isolated ablation (v2.1)** — see above; also unlocks evaling an
  uncommitted SKILL.md reproducibly (`--skill-dir`).
- **Old-vs-new comparison** (`--vs <ref>`) — point the baseline arm at a
  snapshotted SKILL.md instead of "no skill".
- Judge variance — grade N times and vote, or trust one call with evidence?
- Comparator vs per-output grader — a blind A/B "which is better" can be more
  discriminating than independent PASS/FAIL, but is harder to threshold in CI.

---

# v-next — dogfooding findings (2026-07-20) — SHIPPED

Two dogfood passes drove this. **Pass 1** built real suites by driving the tool
as a first-time user (`new` → cases → `lint` → paid runs) and surfaced seven
papercuts — each one making a _correct_ suite look wrong. **Pass 2** re-ran the
loop against the fixed tool and the self-contained example skills, confirming
the fixes end-to-end and catching one deeper bug the first pass had masked.

## Shipped fixes (pass 1)

1. **Run-level `--trials`.** A plain run rejected `--trials` (only `bench` had
   it), so bounding a run's cost meant editing YAML. `--trials <n>` now
   overrides the suite/case value on runs (`cli.js`, `run.js` `RunConfig.trials`,
   precedence `CLI > case > suite > default`).

2. **Per-suite/case `cwd`.** Repo-context skills only fire where there's
   something to act on; the same prompt fired `none` in an empty dir and `1/1`
   in a real repo. A suite (or case) now takes `cwd:`, resolved relative to the
   eval file, plumbed to `runClaude` (`cwd.js`, `run.js`, `bench.js`). Pass 2
   proved it: `review-pr`'s happy cases fired in-repo via `cwd: ../..` instead
   of `fired: none`.

3. **Early-exit cost is a lower bound.** A fast-passing trigger case is
   `SIGKILL`ed before the `result` event that carries `total_cost_usd`, so it
   reports `$0`. The outcome now flags `stoppedEarly`, and the summary renders
   `≥ $X` when any trial exited early (`claude.js`, `report.js`) — and stays
   exact when every case runs to completion.

4. **`lint` spares command templates.** The angle-bracket placeholder check now
   strips inline `` `code` `` spans first, so `` `git diff <fixed-point>...HEAD` ``
   no longer trips `warning placeholder` (`lint.js`).

5. **Legible zero-match filter.** A discovered-but-filtered-empty suite now
   reports `N suite(s) discovered, but no case id matches filter "X"` instead of
   the misleading "no eval suites found" (`load.js` `filteredOut`, `cli.js`).

6. **Offline `validate`.** `skillevel validate [target]` parses suites with no
   `claude` calls, reports schema errors, and previews the run count
   (`≈ N claude runs` for eval, `≈ M` for bench) — the pre-flight before paying
   (`cli.js`).

7. **Broader trigger-keyword extraction.** `resolve.js` now scans description
   **+ body**, strips markdown, and recognises localized markers (English
   `Triggers`, Korean `트리거`, Japanese `トリガー`) — so `new tidy-first` now
   quotes its real Korean trigger list instead of the "no explicit list"
   fallback.

## The bug pass 1 masked (fixed in pass 2)

8. **Every subcommand silently dropped its options.** The root command was a
   default _action_ command (`program.argument(...).action(runCommand)`), which
   makes commander discard sibling subcommands' parsed options — so
   `bench --trials 1 -t X` ran at the defaults (`trials=3`, no filter). Pass 1
   missed it because only one case was benchable, so the ignored `-t` _looked_
   like it worked; adding a root `--trials` in pass 1 then broke `bench`'s
   `--trials` outright. Fix: `run` is now an explicit `{ isDefault: true }`
   subcommand, so `skillevel [target]` and bare `skillevel` still work while
   subcommand options parse correctly. Verified end-to-end:
   `bench commit-style -t happy-bugfix --trials 1` runs one trial per arm
   (and showed a real **+100pp** lift). This also un-broke `-t/-c/-m/--json` on
   every other subcommand.

## Examples are now self-contained skill packages

`examples/` shifted from eval files pointing at external installed skills to
full **production-layout packages** — each skill's `SKILL.md` sits next to its
eval suite:

```
examples/review-pr/{SKILL.md, review-pr.eval.yaml}   # cwd: ../.. showcase
examples/commit-style/{SKILL.md, commit-style.eval.yaml}
examples/smoke.eval.yaml                              # runner self-check
```

The two skills pin **each other's** routing (`review-pr`'s suite routes "write a
commit message" to `commit-style`, and vice-versa) — a fully self-contained
`expect_skill` collision needing no external skills. The authoring toolchain
(`lint`/`fmt`/`validate`) runs on the in-repo copies directly (local skills win
over installed).

Also closed: the invisible `expect_skill` "sibling must actually fire" semantic
(now in the README) and the orphaned `examples/` dir.

## Still open (honest)

- **Overlapping installed siblings out-compete the example.** Pass 2 ran on a
  machine that also has a real `code-review` skill whose description nearly
  matches `review-pr`'s ("review a branch, a PR, since X"); it won some routing.
  That is not a CLI defect — it's exactly the over-triggering collision skillevel
  exists to _detect_ — but it means `review-pr`'s suite only goes fully green in
  an environment without a rival diff-reviewer. The real fix belongs to the
  skills (sharper boundaries), which is a lesson worth leaving in the example.
- **Isolated ablation / `--skill-dir` (v2.1)** — still the biggest gap: eval an
  uncommitted or in-repo `SKILL.md` reproducibly, and ablate a _single_ skill
  rather than blocking all skills. Would also let the example suites run without
  a manual symlink into `~/.claude/skills`.
- **Cost precision** — `≥ $X` is honest but coarse; estimating early-exit spend
  from `num_turns` would tighten it.
