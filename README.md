# skilltree

[![npm](https://img.shields.io/npm/v/skilltree.svg)](https://www.npmjs.com/package/skilltree)
[![CI](https://github.com/junghwan16/skilltree/actions/workflows/ci.yml/badge.svg)](https://github.com/junghwan16/skilltree/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A test runner for Claude Code skills.** Think `vitest`, but a "test" is a
prompt, and the thing under test is your skill's behaviour:

- **Does it trigger?** — fires on the prompts it should, stays out of the
  near-misses it shouldn't. Skills are prompt-triggered and non-deterministic;
  this is the #1 thing that breaks when you write or edit one.
- **Does it help?** — the same prompt answered better _with_ the skill than
  without. If not, the skill isn't earning its tokens.

You describe both in a small YAML file; `skilltree` runs each case repeatedly
through `claude -p`, scores the pass-rate, and prints a familiar test report:

```bash
$ skilltree sql

sql  ./sql.eval.yaml
  ✓ aggregate-revenue      5/5
  ✓ top-advertisers        5/5
  ✗ neg-explain-join       3/5
      ✗ stays out (sql) — fired: sql
  ○ daily-impressions      TODO — unwritten

1 failed · 2 passed · 1 todo   $0.21
```

It also covers the write side of the loop: `new` scaffolds a `SKILL.md`,
`lint` and `fmt` keep it valid and tidy — all offline and deterministic.

## Quick start

Requires [Claude Code](https://claude.com/claude-code) on your `PATH` (the
`claude` CLI, logged in) and Node ≥ 18. No install needed — `npx` works, or
`npm i -g skilltree` for a global command.

Say your team keeps a `sql` skill that writes queries against your warehouse
schema — the tables, the money units, the partition rules base Claude can't guess.

**1. Scaffold with one command:**

```bash
npx skilltree@latest new sql
```

`new` creates whatever the skill is missing and skips what's already there:
if no skill named `sql` exists (locally or installed), it scaffolds
`sql/SKILL.md`; either way it scaffolds `sql.eval.yaml`,
reading the skill's own `SKILL.md` and quoting any trigger keywords it lists
into a comment (or pointing you at its description when it lists none). It
leaves clearly-marked placeholders — it never invents cases for you
(auto-generated tests plant plausible-but-wrong checks).

**2. Replace the placeholders with real prompts** — things you (or your
users) actually typed. Aim for ~5 that should fire and ~5 near-misses that
must not:

```yaml
skill: sql
trials: 5

cases:
  - id: aggregate-revenue
    prompt: "Write a query for last week's revenue by campaign"
    should_trigger: true
    expect:
      - match: "fact_impression" # answer uses the real schema, not an invented table

  - id: neg-explain-join # adjacent topic — must NOT fire
    prompt: "Explain the difference between an INNER JOIN and a LEFT JOIN"
    should_trigger: false
```

**3. Run it:**

```bash
npx skilltree sql
```

Red cases tell you exactly how the skill misfired (`fired: <skill>`); edit
the skill's `description`, run again, repeat until green. When it triggers
right, measure whether it actually improves answers:

```bash
npx skilltree bench sql
```

## Commands

| command                       | what it does                                                           |
| ----------------------------- | ---------------------------------------------------------------------- |
| `skilltree [target]`          | run eval suites — all discovered, or one skill / file                  |
| `skilltree bench [target]`    | A/B each case with vs without the skill; report the lift               |
| `skilltree validate [target]` | offline: parse suites, report schema errors, preview run cost          |
| `skilltree new <skill>`       | scaffold what's missing: `<skill>/SKILL.md` and/or `<skill>.eval.yaml` |
| `skilltree lint [targets…]`   | validate `SKILL.md` files (packaging errors + guidance warnings)       |
| `skilltree fmt [targets…]`    | normalize `SKILL.md` frontmatter/whitespace (`--check` to only report) |

Useful flags on runs: `-t <substr>` filters cases by id, `-m <model>`
overrides the model, `--trials <n>` overrides the suite's trial count (to bound
cost mid-iteration), `-c <n>` sets parallelism, `--json <file>` writes full
machine-readable results, `--ci` makes failures and unwritten cases exit
non-zero, and `bench --min-lift <pp>` fails when the lift drops too low.

Before spending on a real run, `skilltree validate [target]` parses the suites
offline, flags schema errors, and previews the run count (`≈ N claude runs`).

Suites are discovered automatically: any `*.eval.yaml` (or `evals/cases.yaml`)
under the current directory.

See [`examples/`](./examples/) for two self-contained skill packages —
`review-pr` and `sql`, each shipping its `SKILL.md` next to its eval
suite — that pin each other's routing boundary and were built by dogfooding
skilltree's own toolchain.

## Writing cases

The format is the community `evals/cases.yaml` schema (from the `skill-eval`
skill), so your cases aren't locked to this tool.

Every case is a `prompt` plus a trigger expectation — either
`should_trigger: true|false`, or the routing form `expect_skill`:

```yaml
- id: collision-review
  prompt: "Review my branch against main"
  expect_skill: review-pr # the sibling must win; this suite's own skill stays out
```

`expect_skill: <sibling>` pins down the #1 failure mode of a growing skill
collection — two skills fighting over the same prompts. It passes only when the
named sibling **actually fires** _and_ the suite's own skill stays out, so a
green routing case proves the collision landed right — not merely that the
target kept quiet. `expect_skill: none` asserts no skill fires at all.

`expect` adds optional checks on the response itself:

| entry                         | passes when                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `triggered` / `not_triggered` | shorthands validated against `should_trigger`                                      |
| `match: <re>`                 | the case-insensitive regex appears in the response                                 |
| `absent: <re>`                | the regex does **not** appear                                                      |
| `judge: <q>`                  | a fresh Claude (one turn, no skills) grades the response `PASS` against the rubric |

Tips that make suites worth having:

- **Negatives are the point.** Near-misses ("adjacent but must NOT fire")
  catch over-triggering; obviously unrelated prompts catch nothing.
- **Paste real usage.** Production traces and prompts you actually typed beat
  anything invented.
- **Flakes don't fail you.** A case's score is `passes / trials`, green at
  ≥ 0.8 (`--threshold` to change) — one bad trial out of five still passes.
- **TODO is loud.** A prompt still containing a `<placeholder>` reports as
  TODO and fails `--ci`, so scaffolded suites can't silently pass.
- **Repo-context skills need a repo.** A skill that acts on a diff, a failing
  test, or a dirty tree only fires where there's something to act on — in an
  empty directory it reports `fired: none`. Point runs at a fixture with a
  `cwd:` on the suite (or a single case), resolved relative to the eval file:

  ```yaml
  skill: review-pr
  cwd: ../.. # run every case in a real git repo with a diff
  ```

## Does the skill actually help? (`bench`)

Triggering is necessary, not sufficient. `bench` runs each case's prompt
twice — once with the skill available, once with skills blocked
(`--disallowedTools Skill`) — grades both outputs on the case's
`match` / `absent` / `judge` expectations, and reports the lift:

```bash
$ skilltree bench sql

sql  ./sql.eval.yaml
  case                    with   without    lift
  aggregate-revenue        3/3       0/3  +100pp
  top-advertisers          3/3       1/3   +67pp
  neg-explain-join      — skipped (needs should_trigger: true + match/absent/judge)

▲ skill lift: +84pp   (17% → 100%)   2 benched · 1 skipped   $0.85
```

How to read it:

- **lift ≫ 0** — the skill earns its place.
- **lift ≈ 0 across the board** — retire candidate: the model already does
  this without help. Keep the cases as a regression guard.
- **a case at 0pp** — the model handles that prompt fine on its own; the
  skill's value lives in the other cases.

Only happy cases (`should_trigger: true`) with output expectations are
benchable — a trigger-only case has nothing to compare. Trials default to 3
per arm (`--trials`) since every bench case costs two full runs plus a grader
call per `judge`. Both arms run interleaved in the same batch so model drift
hits them equally.

The default baseline blocks _all_ skills (`--disallowedTools Skill`) — cheap,
but it measures "this skill vs no skills", which overstates lift when the
prompt would have pulled in a sibling. **`--isolate`** runs true per-skill
ablation instead: both arms run in throwaway temp projects
(`.claude/skills/…` + `--setting-sources project`), the "with" arm holding
every discoverable skill and the "without" arm every skill _except_ the
target — siblings stay free to fire in both.

### Did my edit improve it? (`--vs <ref>`)

Mid-edit, the question isn't "is this skill worth having" but "is the new
version better than the one it replaces". `--vs <ref>` benches the current
skill (or `--skill-dir` working copy) against its own version at any git ref
— branch, tag, SHA, `HEAD~1` — in the same interleaved batch, siblings
identical in both arms:

```bash
$ skilltree bench sql --vs HEAD

old vs new — new: working copy; old: snapshot at HEAD
sql  ./sql.eval.yaml   (new: working copy, old: HEAD)
  case                     old       new   delta
  aggregate-revenue        1/3       3/3   +67pp

▲ improvement: +67pp   (33% → 100%)   1 compared   $0.90
```

The old side is read from git history (`git show <ref>:…`, including
`references/`), so it doesn't need to be installed — or even still exist in
the working tree. `--min-improvement <pp>` gates CI the way `--min-lift`
does: a skill edit that quietly regresses a benched case fails the build.

## Evaling an uncommitted skill (`--skill-dir`)

By default, runs test whatever `claude -p` already discovers — the installed
skill, not your working copy. `--skill-dir <path>` (a skill directory or its
`SKILL.md`) materializes the working copy into an isolated temp project and
runs everything there, no install or symlink needed:

```bash
skilltree run sql --skill-dir ./skills/sql     # trigger-eval the edit
skilltree bench sql --skill-dir ./skills/sql   # A/B the edit (implies --isolate)
```

The working copy replaces any installed skill of the same frontmatter
`name`; every other discoverable skill is materialized alongside it, so
`expect_skill` routing/collision cases still work. Isolated runs pin their
working directory to the temp project, so they refuse suites that declare a
`cwd:` fixture rather than silently mis-running them.

## Authoring `SKILL.md`

- **`new`** scaffolds a skill directory whose `SKILL.md` carries the
  authoring guidance as a deletable comment (the description is the trigger
  mechanism; keep the body under 500 lines; layer extras into `references/`) —
  plus the eval file, in one go. Anything that already exists is skipped, so
  it's safe to run on an existing skill just to get its cases file.
- **`lint`** reports **errors** for what would break the skill (frontmatter
  shape, kebab-case name, description limits — the `skill-creator` validation
  rules) and **warnings** for guidance drift (leftover TODOs/placeholders,
  body over 500 lines, broken `references/` paths, name ≠ directory).
- **`fmt`** normalizes frontmatter (`name`, `description` first — comments
  and quoting preserved) and trailing whitespace, touching nothing inside
  code fences. When it can't parse a file it leaves it alone.

```bash
$ skilltree lint

sql/SKILL.md
  error unexpected-key — unexpected frontmatter key(s): triggers (allowed: …)
  warning broken-reference — referenced file does not exist: references/schema.md

1 file · 1 errors · 1 warnings
```

`lint` exits non-zero on errors (warnings alone pass); `fmt --check` on
unformatted files.

## CI

The authoring checks are offline; the eval/bench runs need the `claude` CLI
and an API key. A typical GitHub Actions split:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }

# offline — every push
- run: npx skilltree@latest lint && npx skilltree@latest fmt --check

# paid — e.g. only when skills/ or *.eval.yaml changed
- run: npm install -g @anthropic-ai/claude-code
- run: npx skilltree@latest --ci
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
- run: npx skilltree@latest bench --min-lift 10
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

# on skill-touching PRs — fail the build if the edit regressed quality
- run: npx skilltree@latest bench --vs origin/main --min-improvement 0
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Cost stays modest because trigger-only cases exit the moment the verdict is
known — the summary line prints what each run actually cost.

## Good to know

- **What's under test is the _installed_ skill** — whatever `claude -p`
  discovers (`~/.claude/skills`, the project's `.claude/skills`, plugins) —
  unless you pass `--skill-dir` to eval a working copy in isolation.
- **There is deliberately no `--watch`** — every run costs real money and
  minutes; re-running is a decision, not a save-hook.
- **`skill:` must match the Skill tool's name** — the leaf name Claude Code
  shows, not a path.

## License

MIT
