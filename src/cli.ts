#!/usr/bin/env node
/**
 * Command-line entry point. Owns everything process-shaped — argument
 * parsing, the TTY progress line, exit codes — and wires the real console
 * and `claude` CLI runner into the command layer. The real work lives there.
 */

import { createRequire } from "node:module";
import { Command } from "commander";
import pc from "picocolors";
import { ClaudeCliRunner } from "./agent/claude-cli.js";
import { benchCommand } from "./commands/bench.js";
import type { CommandContext } from "./commands/context.js";
import type { ProgressFn } from "./shared/pool.js";
import { fmtCommand } from "./commands/fmt.js";
import { lintCommand } from "./commands/lint.js";
import { newCommand } from "./commands/new.js";
import { runCommand } from "./commands/run.js";
import { validateCommand } from "./commands/validate.js";
import {
  BENCH_TRIALS,
  DEFAULT_CONCURRENCY,
  DEFAULT_THRESHOLD,
} from "./core/constants.js";

const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

/** Raw option values as commander hands them over. */
type RawOptions = Record<string, string | boolean | undefined>;

main();

/** Parse arguments and dispatch. */
function main(): void {
  const ctx = productionContext();
  const program = new Command();
  program
    .name("skilltree")
    .description(
      "A test runner for Claude Code skills. Runs YAML cases through `claude -p`.",
    )
    .version(version);

  // `run` is a real (default) subcommand, not an action on the program itself:
  // a default *action command* makes commander drop every *other* subcommand's
  // parsed options (so `bench --trials`/`-t` silently fell back to defaults).
  program
    .command("run [target]", { isDefault: true })
    .description(
      "run eval suites — all discovered, or one skill / file (default)",
    )
    .option("-t, --filter <substr>", "only run cases whose id contains this")
    .option(
      "-c, --concurrency <n>",
      "parallel runs",
      String(DEFAULT_CONCURRENCY),
    )
    .option("-m, --model <model>", "override the model for all runs")
    .option("--trials <n>", "override trials per case (else the YAML value)")
    .option(
      "--threshold <n>",
      "green pass-rate threshold (0..1)",
      String(DEFAULT_THRESHOLD),
    )
    .option("--json <file>", "also write full results as JSON to a file")
    .option("--ci", "exit non-zero on any failure or unwritten case")
    .option(
      "--skill-dir <path>",
      "eval the working-copy skill at <path> (a skill dir or its SKILL.md) in an isolated temp project — no install/symlink needed",
    )
    .action(async (target: string | undefined, options: RawOptions) => {
      process.exitCode = await runCommand(
        target,
        {
          filter: asString(options.filter),
          concurrency: asNumber(options.concurrency),
          threshold: asNumber(options.threshold),
          model: asString(options.model),
          trials: asNumber(options.trials),
          json: asString(options.json),
          ci: Boolean(options.ci),
          skillDir: asString(options.skillDir),
        },
        ctx,
      );
    });

  program
    .command("bench [target]")
    .description(
      "A/B each case with the skill vs with skills blocked, and report the lift",
    )
    .option("-t, --filter <substr>", "only bench cases whose id contains this")
    .option(
      "-c, --concurrency <n>",
      "parallel runs",
      String(DEFAULT_CONCURRENCY),
    )
    .option("-m, --model <model>", "override the model for all runs")
    .option("--trials <n>", "trials per arm", String(BENCH_TRIALS))
    .option("--json <file>", "also write full results as JSON to a file")
    .option(
      "--min-lift <pp>",
      "exit non-zero when overall lift is below this many percentage points",
    )
    .option(
      "--isolate",
      "true per-skill ablation: both arms run in isolated temp projects; the without arm keeps every skill except the target",
    )
    .option(
      "--skill-dir <path>",
      "bench the working-copy skill at <path> instead of the installed one (implies --isolate)",
    )
    .option(
      "--vs <ref>",
      "old vs new: bench the current skill against its version at a git ref (branch, tag, SHA, HEAD~1) — did the edit improve it?",
    )
    .option(
      "--min-improvement <pp>",
      "with --vs: exit non-zero when the delta is below this many percentage points",
    )
    .action(async (target: string | undefined, options: RawOptions) => {
      process.exitCode = await benchCommand(
        target,
        {
          filter: asString(options.filter),
          concurrency: asNumber(options.concurrency),
          model: asString(options.model),
          trials: asNumber(options.trials),
          json: asString(options.json),
          minLift: asNumber(options.minLift),
          isolate: Boolean(options.isolate),
          skillDir: asString(options.skillDir),
          vs: asString(options.vs),
          minImprovement: asNumber(options.minImprovement),
        },
        ctx,
      );
    });

  program
    .command("validate [target]")
    .description(
      "Offline check: parse eval suites, report schema errors, and preview run cost — no `claude` calls",
    )
    .option("-t, --filter <substr>", "only count cases whose id contains this")
    .action((target: string | undefined, options: RawOptions) => {
      process.exitCode = validateCommand(
        target,
        { filter: asString(options.filter) },
        ctx,
      );
    });

  program
    .command("new <skill> [dir]")
    .description(
      "Scaffold whatever the skill is missing: <skill>/SKILL.md (unless the skill already exists) and <skill>.eval.yaml — templates + guidance; you write the content",
    )
    .action((skill: string, dir: string | undefined) => {
      process.exitCode = newCommand(skill, dir, ctx);
    });

  program
    .command("lint [targets...]")
    .description(
      "Lint SKILL.md files: packaging errors + authoring-guidance warnings",
    )
    .action((targets: string[]) => {
      process.exitCode = lintCommand(targets, ctx);
    });

  program
    .command("fmt [targets...]")
    .description("Normalise SKILL.md frontmatter and whitespace")
    .option("--check", "report files that would change, without writing")
    .action((targets: string[], options: RawOptions) => {
      process.exitCode = fmtCommand(
        targets,
        { check: Boolean(options.check) },
        ctx,
      );
    });

  void program.parseAsync();
}

/** The real-world wiring: console output, `claude` subprocesses, TTY progress. */
function productionContext(): CommandContext {
  return {
    io: {
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    },
    runner: new ClaudeCliRunner(),
    withProgress: ttyProgress,
  };
}

/**
 * Run a suite batch with a `running n/m…` progress line, clearing it
 * afterwards (also on failure, so the error prints on a clean line).
 */
async function ttyProgress<T>(
  run: (onProgress: ProgressFn) => Promise<T>,
): Promise<T> {
  const clearLine = () => process.stdout.write(`\r${" ".repeat(30)}\r`);
  const onProgress = (done: number, total: number) =>
    process.stdout.write(`\r${pc.dim(`running ${done}/${total}…`)}   `);
  try {
    return await run(onProgress);
  } finally {
    clearLine();
  }
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: string | boolean | undefined): number | undefined {
  return typeof value === "string" ? Number(value) : undefined;
}
