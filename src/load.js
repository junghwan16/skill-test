/**
 * @file Reads and validates cases files, and resolves a target (a file, a skill
 * name, or nothing) into the set of suites to run.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { discover } from "./discover.js";

/**
 * A file that could not be loaded.
 *
 * @typedef {object} SkippedFile
 * @property {string} file
 * @property {Error} error
 */

/**
 * Resolve `target` into loaded, filtered suites plus any files that failed to
 * load. Pure and non-mutating — filtered suites are fresh copies.
 *
 * @param {string} [target]      A skill name or an eval file path.
 * @param {string} [caseFilter]  Keep only cases whose id contains this.
 * @returns {{ suites: import('./types.js').Suite[], skipped: SkippedFile[], filteredOut: string[] }}
 *   `filteredOut` = files that parsed fine but whose every case was excluded by
 *   `caseFilter`; lets the caller tell "no suites" from "filter matched nothing".
 */
export function collectSuites(target, caseFilter) {
  /** @type {import('./types.js').Suite[]} */
  const suites = [];
  /** @type {SkippedFile[]} */
  const skipped = [];
  /** @type {string[]} */
  const filteredOut = [];

  for (const file of filesForTarget(target)) {
    try {
      const suite = loadSuite(file);
      const cases = caseFilter
        ? suite.cases.filter((testCase) => testCase.id.includes(caseFilter))
        : suite.cases;
      if (cases.length > 0)
        suites.push(cases === suite.cases ? suite : { ...suite, cases });
      else if (caseFilter) filteredOut.push(file);
    } catch (error) {
      skipped.push({ file, error: /** @type {Error} */ (error) });
    }
  }
  return { suites, skipped, filteredOut };
}

/**
 * The candidate eval files for a target (a file, a skill name, or everything).
 *
 * @param {string} [target]
 * @returns {string[]}
 */
function filesForTarget(target) {
  if (target && fs.statSync(target, { throwIfNoEntry: false })?.isFile())
    return [target];
  const all = discover();
  if (!target) return all;
  return all.filter(
    (file) =>
      path.basename(path.dirname(file)) === target || file.includes(target),
  );
}

/**
 * Load and validate a suite from a YAML file.
 *
 * @param {string} filePath
 * @returns {import('./types.js').Suite}
 * @throws {Error} When the file is missing required fields or has duplicate ids.
 */
export function loadSuite(filePath) {
  /** @type {import('./types.js').Suite} */
  const suite = parse(fs.readFileSync(filePath, "utf8"));
  assert(
    suite && typeof suite.skill === "string",
    `${filePath}: missing 'skill'`,
  );
  assert(
    Array.isArray(suite.cases) && suite.cases.length > 0,
    `${filePath}: no 'cases'`,
  );

  const seenIds = new Set();
  for (const testCase of suite.cases) {
    assert(testCase.id, `${filePath}: a case is missing 'id'`);
    assert(
      testCase.prompt,
      `${filePath}: case '${testCase.id}' is missing 'prompt'`,
    );
    const hasShould = typeof testCase.should_trigger === "boolean";
    const hasExpectSkill = typeof testCase.expect_skill === "string";
    assert(
      hasShould !== hasExpectSkill,
      `${filePath}: case '${testCase.id}' needs exactly one of 'should_trigger: true|false' or 'expect_skill: <skill>|none'`,
    );
    // The rest of the machinery (turn caps, early exit, labels) keys off
    // should_trigger; derive it so expect_skill cases flow through unchanged.
    if (hasExpectSkill) {
      testCase.should_trigger = testCase.expect_skill === suite.skill;
    }
    assert(
      !seenIds.has(testCase.id),
      `${filePath}: duplicate case id '${testCase.id}'`,
    );
    seenIds.add(testCase.id);
  }

  suite.file = filePath;
  return suite;
}

/**
 * Throw with `message` unless `condition` is truthy.
 *
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
