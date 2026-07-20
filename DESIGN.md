# skilltree — design

A test runner for **Claude Code skills**. Think `vitest`, but a "test" is a
prompt and the thing under test is whether a skill fires (and behaves) the way
its author intended.

## Why

Skills are prompt-triggered and non-deterministic. Before shipping or editing
one, two things matter:

1. **Triggering** — does it fire on the prompts it should, and stay out of the
   near-misses it shouldn't (over/under-firing)?
2. (later) **Task quality** — does the skill actually make the output better?

`skilltree` v1 nails **#1** — cheap, fast, the highest-frequency need. v2
ships **#2** as `skilltree bench`: the same cases, run with and without the
skill, graded, reported as lift.

## Positioning

- A **standalone `npx` CLI** — not a Claude Code skill, not tied to one repo.
- It **adopts the community `evals/cases.yaml` schema** (from the `skill-eval`
  skill) rather than inventing one. Cases stay portable; skilltree is just the
  most ergonomic runner + scaffolder for them.
- Mental model: **vitest for skills**. Auto-discovery, `trials` = built-in
  flake handling, `--ci` = regression gate.

## Commands

```
skilltree                    # discover & run every eval (**/*.eval.yaml, evals/cases.yaml)
skilltree sql                # filter to a skill or a file
skilltree -t "negative"      # filter by case id/substring
skilltree --ci               # non-zero exit on any regression / unwritten case
skilltree --json out.json    # machine-readable results alongside the grid
skilltree bench sql          # A/B with vs without the skill; report the lift
skilltree new sql            # scaffold what's missing: sql/SKILL.md and/or sql.eval.yaml
skilltree lint [target...]   # validate SKILL.md files (errors) + guidance heuristics (warnings)
skilltree fmt [--check]      # conservative SKILL.md frontmatter/whitespace normalizer
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

There is a single scaffolding command. `skilltree new <skill>` creates
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
edit without installing it, pass `--skill-dir <path>` — shipped in v2.1, see
below.

## Non-goals

- Multi-harness (Cursor/Codex/Gemini) — `claude -p` only.
- HTML report — terminal + JSON first.

---

# v2 — task-quality A/B (does the skill actually help?) — SHIPPED

v1 answers _does it trigger_. v2 answers _does it improve the output_ — the
question that decides whether a skill is worth its tokens, and whether an edit
made it better. This is the ablation `skill-eval` describes and the A/B loop the
official `skill-creator` runs, packaged as one command: `skilltree bench`.

## The idea

For each case, run the **same prompt twice** — once with the skill available,
once without — grade both outputs, and report the **lift**:

```
$ skilltree bench sql

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

The default baseline is the **blunt** one: `--disallowedTools Skill` blocks
_all_ skills. Cheap and reliable, but it measures "this skill vs no skills",
not "vs this one skill removed" — fine when the case wouldn't pull in a
sibling anyway. `--isolate` (shipped in v2.1, see below) runs the true
per-skill ablation instead.

Both arms run **interleaved in the same batch** (as `skill-creator` does) so
time-of-day and model drift hit both equally, with no early exit — bench needs
the full output.

## CLI surface

```
skilltree bench [target]           # with vs without, report lift
  --trials <n>                     # per arm; defaults to 3 (each case = 2× runs + grading)
  --min-lift <pp>                  # CI gate: exit non-zero when lift drops below this
  --json <file>                    # full A/B results for machines
```

Discovery, `-t` filter, `-m`/`-c`, and the suite `model` carry over from the
eval runner unchanged. `--min-lift` is how a skill edit that quietly regresses
quality fails the build.

## Roadmap / open questions

- **Old-vs-new comparison** (`--vs <ref>`) — shipped in v2.2, see below. ADR:
  [docs/adr/0001-bench-vs-ref.md](./docs/adr/0001-bench-vs-ref.md).
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
   overrides the suite/case value on runs (`cli.ts`, `core/eval-runner.ts` `RunConfig.trials`,
   precedence `CLI > case > suite > default`).

2. **Per-suite/case `cwd`.** Repo-context skills only fire where there's
   something to act on; the same prompt fired `none` in an empty dir and `1/1`
   in a real repo. A suite (or case) now takes `cwd:`, resolved relative to the
   eval file, plumbed to the agent runner (`suite/cwd.ts`, `core/eval-runner.ts`,
   `core/bench-runner.ts`). Pass 2
   proved it: `review-pr`'s happy cases fired in-repo via `cwd: ../..` instead
   of `fired: none`.

3. **Early-exit cost is a lower bound.** A fast-passing trigger case is
   `SIGKILL`ed before the `result` event that carries `total_cost_usd`, so it
   reports `$0`. The outcome now flags `stoppedEarly`, and the summary renders
   `≥ $X` when any trial exited early (`agent/claude-cli.ts`, `report/render.ts`) — and stays
   exact when every case runs to completion.

4. **`lint` spares command templates.** The angle-bracket placeholder check now
   strips inline `` `code` `` spans first, so `` `git diff <fixed-point>...HEAD` ``
   no longer trips `warning placeholder` (`skill-md/lint.ts`).

5. **Legible zero-match filter.** A discovered-but-filtered-empty suite now
   reports `N suite(s) discovered, but no case id matches filter "X"` instead of
   the misleading "no eval suites found" (`suite/load.ts` `filteredOut`, `commands/helpers.ts`).

6. **Offline `validate`.** `skilltree validate [target]` parses suites with no
   `claude` calls, reports schema errors, and previews the run count
   (`≈ N claude runs` for eval, `≈ M` for bench) — the pre-flight before paying
   (`commands/validate.ts`).

7. **Broader trigger-keyword extraction.** `suite/resolve.ts` now scans description
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
   subcommand, so `skilltree [target]` and bare `skilltree` still work while
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
examples/sql/{SKILL.md, sql.eval.yaml}               # lift showcase (proprietary schema)
examples/smoke.eval.yaml                              # runner self-check
```

The two skills pin **each other's** routing (`review-pr`'s suite routes "write a
query" to `sql`, and vice-versa) — a fully self-contained `expect_skill`
collision needing no external skills. `sql` also carries the **lift** story: it
knows a warehouse schema base Claude can't guess, so `bench sql` shows a real
+100pp instead of the ~0pp a well-known format like conventional commits earns.
The authoring toolchain (`lint`/`fmt`/`validate`) runs on the in-repo copies
directly (local skills win over installed).

Also closed: the invisible `expect_skill` "sibling must actually fire" semantic
(now in the README) and the orphaned `examples/` dir.

## Still open (honest)

- **Overlapping installed siblings out-compete the example.** Pass 2 ran on a
  machine that also has a real `code-review` skill whose description nearly
  matches `review-pr`'s ("review a branch, a PR, since X"); it won some routing.
  That is not a CLI defect — it's exactly the over-triggering collision skilltree
  exists to _detect_ — but it means `review-pr`'s suite only goes fully green in
  an environment without a rival diff-reviewer. The real fix belongs to the
  skills (sharper boundaries), which is a lesson worth leaving in the example.
- **Cost precision** — `≥ $X` is honest but coarse; estimating early-exit spend
  from `num_turns` would tighten it.

(The other gap this pass left open — isolated ablation / `--skill-dir` — is
closed by v2.1 below.)

---

# v2.1 — isolated ablation & `--skill-dir` — SHIPPED

One primitive, two features. `suite/isolate.ts` materializes a chosen set of
skills into a throwaway temp project (`<tmp>/.claude/skills/<name>/…`, copies
with symlinks dereferenced); runs then use that project as their cwd with
`--setting-sources project`, so `claude -p` discovers **exactly** the
materialized set — not `~/.claude/skills`, not plugin skills.

The flag choice was verified empirically, not from docs (the docs don't say):
with a decoy skill installed in `~/.claude/skills` and another in a temp
project's `.claude/skills`, a plain run lists both; under
`--setting-sources project` only the project skill remains, and OAuth keeps
working. `--bare` — the flag this doc originally penciled in — turned out to
be the wrong tool: it disables skill _auto-discovery_ entirely (skills only
resolve when explicitly invoked, useless for trigger evals) and restricts
auth to `ANTHROPIC_API_KEY`.

On top of the primitive:

- **`run [target] --skill-dir <path>`** — eval an uncommitted working copy
  (a skill dir or its `SKILL.md`) reproducibly. The materialized project
  holds every discoverable skill, with the working copy overriding its
  installed namesake, so `expect_skill` routing/collision cases keep working.
- **`bench [target] --isolate`** — true per-skill ablation: the "with" arm's
  project holds every skill, the "without" arm's every skill _except_ the
  target, and the Skill tool stays available in both — siblings are free to
  fire, so the lift no longer conflates "this skill" with "any skill".
- **`bench --skill-dir <path>`** — implies `--isolate` with the working copy
  as the target: A/B an edit before installing it.

Details that mattered:

- **Skills are keyed by frontmatter `name`, not folder name.** Dogfooding
  caught this: a working copy in `wip-skill/` slipped back into the ablated
  arm under its folder name, and the e2e lift read 0pp; keying by the name
  the Skill tool actually matches on fixed it (+100pp on the same case).
- **Isolated runs refuse suites that declare `cwd:`** — a repo-context
  fixture and isolation both want to own the working directory, and silently
  mis-running one of them is worse than a clear error. Composing the two is
  still open (below).
- Temp projects are removed in a per-run `finally`; the with-arm project is
  shared across suites, the without-arm is materialized per target skill.

Open: composing `--skill-dir` with `cwd:` fixtures (a repo-context skill
edit currently still needs the manual symlink), and ablating plugin-provided
skills (they can't be materialized as project skills).

---

# v2.2 — `bench --vs <ref>`: did this edit improve the skill? — SHIPPED

ADR-0001 ([docs/adr/0001-bench-vs-ref.md](./docs/adr/0001-bench-vs-ref.md))
sequenced this on purpose: land the isolation primitive first, then build the old side on top
of it. That's exactly how it shipped — the bench runner needed **zero
changes**: `--vs` is just a different way of building the two `ArmProjects`.

- `suite/snapshot.ts` materializes the version of a skill dir at any git ref
  into a temp dir (`git ls-tree -r` + `git show <ref>:<path>`, every file
  under the dir — SKILL.md, `references/`, scripts). A file added since the
  ref is simply absent, which is correct: that's part of what changed. The
  old version doesn't need to be installed — or to still exist on disk.
- The "new" arm's project holds every discoverable skill with the current
  (or `--skill-dir`) target; the "old" arm's is identical except the target
  is replaced by its snapshot. Siblings are the same in both arms, both arms
  run isolated (`--setting-sources project`) and interleaved in one batch,
  and the Skill tool stays available — only the skill's own text varies.
- Report relabels to `old / new / delta` with the ref in the suite header;
  the summary reads `▲/▼ improvement: ±NNpp (old% → new%) … K compared`. A
  regression paints red, per the PRD.
- `--min-improvement <pp>` gates CI like `--min-lift` does (the PRD's
  "vs. previous version" gate); `--json` results carry
  `mode: "vs-ref" | "ablate" | "vs-baseline"` (+ `ref`) so machine consumers
  can't misread which baseline produced the numbers.
- Clear failures per the PRD: outside a git working tree, an unknown ref
  (git's own reason quoted), and a skill that didn't exist at the ref
  (`skill 'x' did not exist at '<ref>'`).

PRD open questions resolved pragmatically: no ref default (explicit `--vs
HEAD` for "vs last commit" — matches `git diff HEAD` framing without
guessing), trials keep bench's default of 3 per arm, references-only edits
always re-bench (no skip-if-unchanged heuristic).

## Code layout (TypeScript)

The source is TypeScript (`tsc` → `dist/`, published as the `skilltree` bin),
layered so each dependency points inward and every use case is testable
offline:

```
src/
  cli.ts          # entry point: commander wiring, TTY progress, exit codes
  commands/       # use-case layer — one function per subcommand; takes a
                  #   CommandContext (io + runner), returns an exit code
  core/           # domain: types, case classification, checks, the eval and
                  #   bench runners, pure result summaries
  agent/          # the `claude -p` boundary: AgentRunner port, the subprocess
                  #   adapter, pure NDJSON stream interpretation, LLM judge
  suite/          # eval-file discovery, YAML loading/validation, skill lookup
  skill-md/       # SKILL.md domain: frontmatter/grammar, lint, fmt, scaffolds
  report/         # terminal rendering of results
  shared/         # fs walker, worker pool
```

The single seam that matters is **`AgentRunner`** (`agent/agent-runner.ts`):
runners, bench, and the judge depend on that interface, never on the
subprocess. `tests/` (vitest) exercises every scoring, routing, early-stop,
lift, lint, and CLI-exit-code path with a scripted fake runner and real YAML
in temp dirs — no `claude` binary, no network, no dollars.
