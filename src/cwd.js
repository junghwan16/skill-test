/**
 * @file Resolves the working directory a case's `claude -p` run should use.
 * Repo-context skills (code-review, tdd, changelog…) only trigger where there
 * is something to act on, so a suite/case can point runs at a fixture repo.
 */

import path from "node:path";

/**
 * The absolute working directory for a case's runs, or `undefined` to inherit
 * the process cwd. A case-level `cwd` wins over the suite's; both are resolved
 * relative to the eval file's directory so suites stay portable.
 *
 * @param {import('./types.js').Suite} suite
 * @param {import('./types.js').TestCase} testCase
 * @returns {string | undefined}
 */
export function resolveCwd(suite, testCase) {
  const rel = testCase.cwd ?? suite.cwd;
  if (!rel) return undefined;
  const base = suite.file ? path.dirname(suite.file) : process.cwd();
  return path.resolve(base, rel);
}
