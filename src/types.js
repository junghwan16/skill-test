/**
 * @file Shared type definitions expressed as JSDoc typedefs. This module has no
 * runtime code; other modules reference these shapes via
 * `import('./types.js').TypeName`.
 */

/**
 * A single assertion in a case's `expect` list.
 *
 * - `"triggered"` / `"not_triggered"` — shorthands validated against
 *   `should_trigger`; the real trigger check is always derived from that field.
 * - `{ match }` — a case-insensitive regex that must appear in the response.
 * - `{ absent }` — a regex that must NOT appear in the response.
 * - `{ judge }` — a rubric question answered PASS/FAIL by a fresh LLM judge.
 *
 * @typedef {"triggered" | "not_triggered" | { match: string } | { absent: string } | { judge: string }} Expectation
 */

/**
 * One test case: a prompt plus the behaviour expected of the skill.
 *
 * A case declares its trigger expectation in one of two ways:
 * - `should_trigger: true|false` — should the target skill fire?
 * - `expect_skill: <name>|none` — which skill should win the routing? The
 *   suite's own skill (≡ `should_trigger: true`), a sibling (the sibling must
 *   fire and the target must stay out — a collision case), or `none` (no skill
 *   at all may fire). The loader derives `should_trigger` from it.
 *
 * @typedef {object} TestCase
 * @property {string} id                     Unique within the suite.
 * @property {string} prompt                 What the user would type. An unfilled
 *                                           `<placeholder>` marks the case as unwritten.
 * @property {boolean} should_trigger        Whether the target skill should fire.
 * @property {string} [expect_skill]         The skill that should win, or "none".
 * @property {number} [trials]               Per-case override of the suite's trials.
 * @property {string} [cwd]                  Working dir for this case's runs (see Suite.cwd).
 * @property {Expectation[]} [expect]        Extra assertions beyond the trigger check.
 */

/**
 * A cases file (the community `evals/cases.yaml` schema).
 *
 * @typedef {object} Suite
 * @property {string} skill                  Leaf skill name; must match the Skill tool's name.
 * @property {TestCase[]} cases
 * @property {number} [trials]               Default trials per case.
 * @property {string} [model]                Model passed to `claude --model`.
 * @property {number} [triggerThreshold]     Green pass-rate threshold (0..1).
 * @property {string} [cwd]                  Working dir for runs, relative to the eval file.
 *                                           Repo-context skills only trigger where there's
 *                                           something to act on (a diff, a failing test).
 * @property {string} [file]                 Source path; filled in by the loader.
 */

/**
 * The observable result of a single `claude -p` run.
 *
 * @typedef {object} RunOutcome
 * @property {string} text                   Final assistant text.
 * @property {string[]} skillsFired          Distinct skills invoked, in order seen.
 * @property {string[]} toolsUsed            Distinct tool names invoked.
 * @property {number} costUsd                Reported cost of the run (0 when stopped early).
 * @property {number} numTurns
 * @property {boolean} stoppedEarly          True when killed on the trigger verdict, before the cost event.
 * @property {boolean} isError               True only for genuine failures (not early stops).
 */

/**
 * The outcome of evaluating one assertion.
 *
 * @typedef {object} CheckResult
 * @property {string} label
 * @property {boolean} ok
 * @property {string} [detail]               Why it failed, when it did.
 */

/**
 * One trial of a case: the run plus its checks.
 *
 * @typedef {object} TrialResult
 * @property {RunOutcome} outcome
 * @property {CheckResult[]} checks
 * @property {boolean} pass                  True when every check passed.
 */

/**
 * @typedef {"pass" | "fail" | "todo"} CaseStatus
 * `"todo"` means the case is an unwritten placeholder.
 */

/**
 * Aggregated result for one case across its trials.
 *
 * @typedef {object} CaseResult
 * @property {string} id
 * @property {string} skill
 * @property {CaseStatus} status
 * @property {number} passRate               Fraction of trials that passed (0..1).
 * @property {number} passed                 Number of trials that passed.
 * @property {TrialResult[]} trials
 * @property {number} costUsd
 */

/**
 * Aggregated result for one suite.
 *
 * @typedef {object} SuiteResult
 * @property {string} skill
 * @property {string} file
 * @property {number} threshold              Green pass-rate threshold for this suite.
 * @property {CaseResult[]} cases
 */

export {};
