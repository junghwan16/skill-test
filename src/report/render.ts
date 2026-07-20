/**
 * Turns run results into terminal output: the case grid for evals, the A/B
 * lift table for bench, and the closing summary lines. Machine output is
 * plain JSON of the result objects, written by the CLI via `--json`. All
 * pure string builders — aggregation lives in `core/summary.ts`.
 */

import pc from "picocolors";
import type {
  BenchCaseResult,
  BenchSuiteResult,
} from "../core/bench-runner.js";
import type { BenchSummary, Summary } from "../core/summary.js";
import type { CaseResult, CheckResult, SuiteResult } from "../core/types.js";

/** Render the closing one-line summary. */
export function renderSummary(summary: Summary): string {
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

/** Render the per-case grid for an eval run. */
export function renderGrid(suites: SuiteResult[]): string {
  const lines: string[] = [];
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
 * Old-vs-new mode (`bench --vs <ref>`): relabels the table and summary — the
 * "with" arm is the new version, the "without" arm the old one at `ref`.
 */
export interface VsMode {
  ref: string;
  /** Where the new arm came from, e.g. "working copy". */
  newSource: string;
}

/** Render the A/B lift table for a bench run, one block per suite. */
export function renderBench(suites: BenchSuiteResult[], vs?: VsMode): string {
  const lines: string[] = [];
  for (const suite of suites) {
    const note = vs ? `   (new: ${vs.newSource}, old: ${vs.ref})` : "";
    lines.push("", pc.bold(suite.skill) + pc.dim(`  ${suite.file}${note}`));
    lines.push(
      pc.dim(
        vs
          ? `  ${"case".padEnd(22)}${"old".padStart(6)}${"new".padStart(10)}${"delta".padStart(8)}`
          : `  ${"case".padEnd(22)}${"with".padStart(6)}${"without".padStart(10)}${"lift".padStart(8)}`,
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
      // In vs mode the old arm (withoutPassed) reads first, matching the
      // before → after direction of the summary rates.
      const [first, second] = vs
        ? [c.withoutPassed, c.withPassed]
        : [c.withPassed, c.withoutPassed];
      lines.push(
        id +
          `${first}/${c.trials}`.padStart(6) +
          `${second}/${c.trials}`.padStart(10) +
          paintLift(liftPp(c), 8),
      );
    }
  }
  return lines.join("\n");
}

/** Render the closing bench summary: overall lift, rates, and cost. */
export function renderBenchSummary(summary: BenchSummary, vs?: VsMode): string {
  if (summary.benched === 0) {
    const hint = vs
      ? "— --vs compares outputs, so it needs happy cases (should_trigger: true) with match/absent/judge expectations"
      : "— bench needs happy cases (should_trigger: true) with match/absent/judge expectations";
    return `\n${pc.yellow(vs ? "nothing to compare" : "nothing to bench")} ${pc.dim(hint)}`;
  }
  const arrow =
    summary.liftPp > 0
      ? pc.green("▲")
      : summary.liftPp < 0
        ? pc.red("▼")
        : pc.dim("▬");
  const rates = `(${pct(summary.withoutRate)} → ${pct(summary.withRate)})`;
  const counts = [
    `${summary.benched} ${vs ? "compared" : "benched"}`,
    summary.skipped ? `${summary.skipped} skipped` : null,
    summary.todo ? `${summary.todo} todo` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `\n${arrow} ${vs ? "improvement" : "skill lift"}: ${paintLift(summary.liftPp)}   ${pc.dim(
    `${rates}   ${counts}   $${summary.costUsd.toFixed(3)}`,
  )}`;
}

/** A case's lift in percentage points. */
function liftPp(c: BenchCaseResult): number {
  return Math.round(((c.withPassed - c.withoutPassed) / c.trials) * 100);
}

/**
 * Colour a lift value: green up, red down, dim flat. Padding is applied to
 * the plain text so ANSI codes don't skew column widths.
 */
function paintLift(pp: number, width = 0): string {
  const text = `${pp > 0 ? "+" : ""}${pp}pp`.padStart(width);
  return pp > 0 ? pc.green(text) : pp < 0 ? pc.red(text) : pc.dim(text);
}

/** "82%". */
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** The status glyph for a case. */
function glyph(caseResult: CaseResult): string {
  if (caseResult.status === "pass") return pc.green("✓");
  if (caseResult.status === "todo") return pc.yellow("○");
  return pc.red("✗");
}

/** The first failing check of the first failing trial, for a hint line. */
function firstFailure(caseResult: CaseResult): CheckResult | undefined {
  return caseResult.trials
    .find((trial) => !trial.pass)
    ?.checks.find((check) => !check.ok);
}
