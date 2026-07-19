/**
 * @file The v2 A/B runner: each benchable case runs the same prompt with the
 * skill available and with all skills blocked (`--disallowedTools Skill`),
 * grades both outputs on the case's output checks, and reports the lift.
 *
 * Only happy cases with output checks (`match` / `absent` / `judge`) are
 * benchable — a trigger-only case has nothing to compare, and a "must not
 * fire" case is identical in both arms. Both arms run interleaved in the same
 * pool so time-of-day and model drift hit them equally.
 */

import { runClaude } from "./claude.js";
import { evaluateOutputChecks } from "./assert.js";
import { runPool } from "./pool.js";
import { isUnwritten, hasOutputChecks } from "./testcase.js";
import { resolveCwd } from "./cwd.js";
import {
  BENCH_TRIALS,
  DEFAULT_CONCURRENCY,
  HAPPY_MAX_TURNS,
  RUN_TIMEOUT_MS,
} from "./constants.js";

/**
 * Bench configuration.
 *
 * @typedef {object} BenchConfig
 * @property {number} [trials]                   Trials per arm (default {@link BENCH_TRIALS}).
 * @property {number} [concurrency]
 * @property {string} [model]                    Overrides each suite's model.
 * @property {number} [timeoutMs]
 * @property {(done: number, total: number) => void} [onProgress]
 */

/**
 * A/B result for one case.
 *
 * @typedef {object} BenchCaseResult
 * @property {string} id
 * @property {"done" | "skipped" | "todo"} status  `skipped` = no output checks or negative case.
 * @property {number} trials                     Trials per arm.
 * @property {number} withPassed                 Passing trials with the skill available.
 * @property {number} withoutPassed              Passing trials with skills blocked.
 * @property {number} costUsd                    Both arms combined.
 */

/**
 * A/B result for one suite.
 *
 * @typedef {object} BenchSuiteResult
 * @property {string} skill
 * @property {string} file
 * @property {BenchCaseResult[]} cases
 */

/**
 * Bench every benchable case in every suite.
 *
 * @param {import('./types.js').Suite[]} suites
 * @param {BenchConfig} [config]
 * @returns {Promise<BenchSuiteResult[]>}
 */
export async function benchSuites(suites, config = {}) {
  const trials = config.trials ?? BENCH_TRIALS;
  /** @type {BenchSuiteResult[]} */
  const results = [];
  /** @type {Array<() => Promise<void>>} */
  const jobs = [];

  for (const suite of suites) {
    const model = config.model ?? suite.model;
    /** @type {BenchSuiteResult} */
    const suiteResult = {
      skill: suite.skill,
      file: suite.file ?? "",
      cases: [],
    };
    results.push(suiteResult);

    for (const testCase of suite.cases) {
      /** @type {BenchCaseResult} */
      const caseResult = {
        id: testCase.id,
        status: "done",
        trials,
        withPassed: 0,
        withoutPassed: 0,
        costUsd: 0,
      };
      suiteResult.cases.push(caseResult);

      if (isUnwritten(testCase)) {
        caseResult.status = "todo";
        continue;
      }
      if (!testCase.should_trigger || !hasOutputChecks(testCase)) {
        caseResult.status = "skipped";
        continue;
      }
      const cwd = resolveCwd(suite, testCase);
      for (let trial = 0; trial < trials; trial += 1) {
        // Interleave the arms so drift hits both equally.
        jobs.push(armJob(testCase, model, config, caseResult, false, cwd));
        jobs.push(armJob(testCase, model, config, caseResult, true, cwd));
      }
    }
  }

  await runPool(
    jobs,
    config.concurrency ?? DEFAULT_CONCURRENCY,
    config.onProgress,
  );
  return results;
}

/**
 * One trial of one arm. Mutates `caseResult`.
 *
 * @param {import('./types.js').TestCase} testCase
 * @param {string | undefined} model
 * @param {BenchConfig} config
 * @param {BenchCaseResult} caseResult
 * @param {boolean} withoutSkill
 * @param {string | undefined} cwd
 * @returns {() => Promise<void>}
 */
function armJob(testCase, model, config, caseResult, withoutSkill, cwd) {
  return async () => {
    const outcome = await runClaude(testCase.prompt, {
      model,
      maxTurns: HAPPY_MAX_TURNS, // no early exit — bench needs the full output
      timeoutMs: config.timeoutMs ?? RUN_TIMEOUT_MS,
      cwd,
      disallowSkills: withoutSkill,
    });
    const checks = await evaluateOutputChecks(testCase, outcome, model);
    if (checks.every((check) => check.ok)) {
      if (withoutSkill) caseResult.withoutPassed += 1;
      else caseResult.withPassed += 1;
    }
    caseResult.costUsd += outcome.costUsd;
  };
}

/**
 * Aggregate pass-rates and lift across all benched cases.
 *
 * @typedef {object} BenchSummary
 * @property {number} benched                    Cases actually A/B-run.
 * @property {number} skipped
 * @property {number} todo
 * @property {number} withRate                   0..1 across all benched trials.
 * @property {number} withoutRate
 * @property {number} liftPp                     (withRate - withoutRate) in percentage points.
 * @property {number} costUsd
 */

/**
 * @param {BenchSuiteResult[]} suites
 * @returns {BenchSummary}
 */
export function summarizeBench(suites) {
  const cases = suites.flatMap((suite) => suite.cases);
  const benched = cases.filter((c) => c.status === "done");
  const totalTrials = benched.reduce((sum, c) => sum + c.trials, 0);
  const withRate = totalTrials
    ? benched.reduce((sum, c) => sum + c.withPassed, 0) / totalTrials
    : 0;
  const withoutRate = totalTrials
    ? benched.reduce((sum, c) => sum + c.withoutPassed, 0) / totalTrials
    : 0;
  return {
    benched: benched.length,
    skipped: cases.filter((c) => c.status === "skipped").length,
    todo: cases.filter((c) => c.status === "todo").length,
    withRate,
    withoutRate,
    liftPp: Math.round((withRate - withoutRate) * 100),
    costUsd: cases.reduce((sum, c) => sum + c.costUsd, 0),
  };
}
