/**
 * @file Turns run results into terminal output: the case grid for evals, the
 * A/B lift table for bench, and the closing summary lines. Machine output is
 * plain JSON of the result objects, written by the CLI via `--json`.
 */

import pc from "picocolors";

/**
 * @typedef {object} Summary
 * @property {number} pass
 * @property {number} fail
 * @property {number} todo
 * @property {number} costUsd
 * @property {boolean} costPartial          Some trials stopped early, so the total is a lower bound.
 */

/**
 * Count outcomes across all suites.
 *
 * @param {import('./types.js').SuiteResult[]} suites
 * @returns {Summary}
 */
export function summarize(suites) {
  const cases = suites.flatMap((suite) => suite.cases);
  /** @param {import('./types.js').CaseStatus} status */
  const count = (status) => cases.filter((c) => c.status === status).length;
  return {
    pass: count("pass"),
    fail: count("fail"),
    todo: count("todo"),
    costUsd: cases.reduce((total, c) => total + c.costUsd, 0),
    costPartial: cases.some((c) =>
      c.trials.some((trial) => trial.outcome.stoppedEarly),
    ),
  };
}

/**
 * Render the closing one-line summary.
 *
 * @param {Summary} summary
 * @returns {string}
 */
export function renderSummary(summary) {
  const parts = [
    summary.fail ? pc.red(`${summary.fail} failed`) : pc.dim("0 failed"),
    pc.green(`${summary.pass} passed`),
    summary.todo ? pc.yellow(`${summary.todo} todo`) : pc.dim("0 todo"),
  ];
  // Early-exit trials are SIGKILLed before the cost event, so their spend is
  // unaccounted — mark the total as a floor rather than overclaiming precision.
  const cost = `${summary.costPartial ? "≥ " : ""}$${summary.costUsd.toFixed(3)}`;
  return `\n${parts.join(pc.dim(" · "))}${pc.dim(`   ${cost}`)}`;
}

/**
 * Render the per-case grid for an eval run.
 *
 * @param {import('./types.js').SuiteResult[]} suites
 * @returns {string}
 */
export function renderGrid(suites) {
  const lines = [];
  for (const suite of suites) {
    lines.push("", pc.bold(suite.skill) + pc.dim(`  ${suite.file}`));
    for (const caseResult of suite.cases) {
      const detail =
        caseResult.status === "todo"
          ? pc.yellow("TODO — unwritten")
          : `${caseResult.passed}/${caseResult.trials.length}`;
      lines.push(
        `  ${glyph(caseResult)} ${caseResult.id.padEnd(18)} ${pc.dim(detail)}`,
      );
      if (caseResult.status === "fail") {
        const failure = firstFailure(caseResult);
        if (failure)
          lines.push(
            pc.dim(
              `      ✗ ${failure.label}${failure.detail ? ` — ${failure.detail}` : ""}`,
            ),
          );
      }
    }
  }
  return lines.join("\n");
}

/**
 * Render the A/B lift table for a bench run, one block per suite.
 *
 * @param {import('./bench.js').BenchSuiteResult[]} suites
 * @returns {string}
 */
export function renderBench(suites) {
  const lines = [];
  for (const suite of suites) {
    lines.push("", pc.bold(suite.skill) + pc.dim(`  ${suite.file}`));
    lines.push(
      pc.dim(
        `  ${"case".padEnd(22)}${"with".padStart(6)}${"without".padStart(10)}${"lift".padStart(8)}`,
      ),
    );
    for (const c of suite.cases) {
      const id = `  ${c.id.padEnd(22)}`;
      if (c.status === "todo") {
        lines.push(id + pc.yellow("TODO — unwritten"));
        continue;
      }
      if (c.status === "skipped") {
        lines.push(
          id +
            pc.dim(
              "— skipped (needs should_trigger: true + match/absent/judge)",
            ),
        );
        continue;
      }
      lines.push(
        id +
          `${c.withPassed}/${c.trials}`.padStart(6) +
          `${c.withoutPassed}/${c.trials}`.padStart(10) +
          paintLift(liftPp(c), 8),
      );
    }
  }
  return lines.join("\n");
}

/**
 * Render the closing bench summary: overall lift, rates, and cost.
 *
 * @param {import('./bench.js').BenchSummary} summary
 * @returns {string}
 */
export function renderBenchSummary(summary) {
  if (summary.benched === 0) {
    return `\n${pc.yellow("nothing to bench")} ${pc.dim(
      "— bench needs happy cases (should_trigger: true) with match/absent/judge expectations",
    )}`;
  }
  const arrow =
    summary.liftPp > 0
      ? pc.green("▲")
      : summary.liftPp < 0
        ? pc.red("▼")
        : pc.dim("▬");
  const rates = `(${pct(summary.withoutRate)} → ${pct(summary.withRate)})`;
  const counts = [
    `${summary.benched} benched`,
    summary.skipped ? `${summary.skipped} skipped` : null,
    summary.todo ? `${summary.todo} todo` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `\n${arrow} skill lift: ${paintLift(summary.liftPp)}   ${pc.dim(
    `${rates}   ${counts}   $${summary.costUsd.toFixed(3)}`,
  )}`;
}

/**
 * A case's lift in percentage points.
 *
 * @param {import('./bench.js').BenchCaseResult} c
 * @returns {number}
 */
function liftPp(c) {
  return Math.round(((c.withPassed - c.withoutPassed) / c.trials) * 100);
}

/**
 * Colour a lift value: green up, red down, dim flat. Padding is applied to
 * the plain text so ANSI codes don't skew column widths.
 *
 * @param {number} pp
 * @param {number} [width]
 * @returns {string}
 */
function paintLift(pp, width = 0) {
  const text = `${pp > 0 ? "+" : ""}${pp}pp`.padStart(width);
  return pp > 0 ? pc.green(text) : pp < 0 ? pc.red(text) : pc.dim(text);
}

/**
 * "82%".
 *
 * @param {number} rate
 * @returns {string}
 */
function pct(rate) {
  return `${Math.round(rate * 100)}%`;
}

/**
 * The status glyph for a case.
 *
 * @param {import('./types.js').CaseResult} caseResult
 * @returns {string}
 */
function glyph(caseResult) {
  if (caseResult.status === "pass") return pc.green("✓");
  if (caseResult.status === "todo") return pc.yellow("○");
  return pc.red("✗");
}

/**
 * The first failing check of the first failing trial, for a hint line.
 *
 * @param {import('./types.js').CaseResult} caseResult
 * @returns {import('./types.js').CheckResult | undefined}
 */
function firstFailure(caseResult) {
  return caseResult.trials
    .find((trial) => !trial.pass)
    ?.checks.find((check) => !check.ok);
}
