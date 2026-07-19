/**
 * @file Orchestrates running suites: each case runs `trials` times, in parallel
 * up to a concurrency limit, and is scored by pass-rate.
 */

import { runClaude } from "./claude.js";
import { evaluateTrial } from "./assert.js";
import { runPool } from "./pool.js";
import { isUnwritten, hasOutputChecks } from "./testcase.js";
import { resolveCwd } from "./cwd.js";
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_THRESHOLD,
  DEFAULT_TRIALS,
  HAPPY_MAX_TURNS,
  NEGATIVE_MAX_TURNS,
  RUN_TIMEOUT_MS,
} from "./constants.js";

/**
 * Run configuration shared across suites.
 *
 * @typedef {object} RunConfig
 * @property {number} [concurrency]
 * @property {number} [threshold]                Global green threshold (0..1).
 * @property {string} [model]                    Overrides each suite's model.
 * @property {number} [trials]                   Overrides each suite's/case's trials.
 * @property {number} [timeoutMs]
 * @property {(done: number, total: number) => void} [onProgress]
 */

/**
 * Run every case in every suite and return per-suite results.
 *
 * @param {import('./types.js').Suite[]} suites
 * @param {RunConfig} [config]
 * @returns {Promise<import('./types.js').SuiteResult[]>}
 */
export async function runSuites(suites, config = {}) {
  const defaultThreshold = config.threshold ?? DEFAULT_THRESHOLD;
  const results = suites.map((suite) => emptyResult(suite, defaultThreshold));
  /** @type {Array<() => Promise<void>>} */
  const jobs = [];

  suites.forEach((suite, suiteIndex) => {
    const model = config.model ?? suite.model;
    for (const testCase of suite.cases) {
      const caseResult = blankCaseResult(testCase.id, suite.skill);
      results[suiteIndex].cases.push(caseResult);

      if (isUnwritten(testCase)) {
        caseResult.status = "todo"; // unwritten — nothing to run
        continue;
      }
      for (const job of caseJobs(testCase, suite, model, config, caseResult))
        jobs.push(job);
    }
  });

  await runPool(
    jobs,
    config.concurrency ?? DEFAULT_CONCURRENCY,
    config.onProgress,
  );
  finalizeScores(results);
  return results;
}

/**
 * Build the trial jobs for a single case. Each job mutates `caseResult`.
 *
 * @param {import('./types.js').TestCase} testCase
 * @param {import('./types.js').Suite} suite
 * @param {string | undefined} model
 * @param {RunConfig} config
 * @param {import('./types.js').CaseResult} caseResult
 * @returns {Array<() => Promise<void>>}
 */
function caseJobs(testCase, suite, model, config, caseResult) {
  // A CLI `--trials` overrides everything; otherwise per-case beats per-suite.
  const trials =
    config.trials ?? testCase.trials ?? suite.trials ?? DEFAULT_TRIALS;
  const stopOnSkill = makeStopPredicate(testCase, suite.skill);
  const maxTurns = testCase.should_trigger
    ? HAPPY_MAX_TURNS
    : NEGATIVE_MAX_TURNS;
  const cwd = resolveCwd(suite, testCase);

  return Array.from({ length: trials }, () => async () => {
    const outcome = await runClaude(testCase.prompt, {
      model,
      maxTurns,
      timeoutMs: config.timeoutMs ?? RUN_TIMEOUT_MS,
      cwd,
      stopOnSkill,
    });
    const checks = await evaluateTrial(testCase, suite.skill, outcome, model);
    caseResult.trials.push({
      outcome,
      checks,
      pass: checks.every((check) => check.ok),
    });
    caseResult.costUsd += outcome.costUsd;
  });
}

/**
 * Decide when a run can stop early — only once the trigger verdict is settled.
 * Cases with output checks must run to completion.
 *
 * @param {import('./types.js').TestCase} testCase
 * @param {string} skill
 * @returns {(firedSkill: string) => boolean}
 */
function makeStopPredicate(testCase, skill) {
  // "no skill may fire": any skill firing settles the verdict (fail fast).
  if (testCase.expect_skill === "none") return () => true;
  const runToCompletion = testCase.should_trigger && hasOutputChecks(testCase);
  return (firedSkill) => {
    // A sibling firing settles nothing — the target could still fire later.
    if (firedSkill !== skill) return false;
    // target fired: "must not fire" → fail fast; trigger-only → pass fast
    return !runToCompletion;
  };
}

/**
 * Compute each case's passed count, pass-rate, and status.
 *
 * @param {import('./types.js').SuiteResult[]} results
 * @returns {void}
 */
function finalizeScores(results) {
  for (const suiteResult of results) {
    for (const caseResult of suiteResult.cases) {
      if (caseResult.status === "todo") continue;
      caseResult.passed = caseResult.trials.filter(
        (trial) => trial.pass,
      ).length;
      caseResult.passRate = caseResult.trials.length
        ? caseResult.passed / caseResult.trials.length
        : 0;
      caseResult.status =
        caseResult.passRate >= suiteResult.threshold ? "pass" : "fail";
    }
  }
}

/**
 * @param {import('./types.js').Suite} suite
 * @param {number} defaultThreshold
 * @returns {import('./types.js').SuiteResult}
 */
function emptyResult(suite, defaultThreshold) {
  return {
    skill: suite.skill,
    file: suite.file ?? "",
    threshold: suite.triggerThreshold ?? defaultThreshold,
    cases: [],
  };
}

/**
 * @param {string} id
 * @param {string} skill
 * @returns {import('./types.js').CaseResult}
 */
function blankCaseResult(id, skill) {
  return {
    id,
    skill,
    status: "pass",
    passRate: 0,
    passed: 0,
    trials: [],
    costUsd: 0,
  };
}
