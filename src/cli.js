#!/usr/bin/env node
/**
 * @file Command-line entry point. Wires the pieces together; the real work
 * lives in the sibling modules.
 */

import fs from "node:fs";
import { Command } from "commander";
import pc from "picocolors";
import { collectSuites } from "./load.js";
import { runSuites } from "./run.js";
import { render, renderSummary, summarize } from "./report.js";
import { initSuite } from "./init.js";
import { newSkill } from "./scaffold.js";
import { lintSkillMd } from "./lint.js";
import { formatSkillMd } from "./fmt.js";
import { findSkill, resolveSkillMds } from "./resolve.js";
import { DEFAULT_CONCURRENCY, DEFAULT_THRESHOLD } from "./constants.js";

const WATCH_DEBOUNCE_MS = 300;

main();

/** Parse arguments and dispatch. */
function main() {
  const program = new Command();
  program
    .name("skillevel")
    .description(
      "A test runner for Claude Code skills. Runs YAML cases through `claude -p`.",
    )
    .version("0.2.0");

  program
    .argument(
      "[target]",
      "a skill name or an eval file; omit to run everything discovered",
    )
    .option("-w, --watch", "re-run on file changes")
    .option("-t, --filter <substr>", "only run cases whose id contains this")
    .option("-r, --reporter <name>", "grid | dot | json | junit", "grid")
    .option(
      "-c, --concurrency <n>",
      "parallel runs",
      String(DEFAULT_CONCURRENCY),
    )
    .option("-m, --model <model>", "override the model for all runs")
    .option(
      "--threshold <n>",
      "green pass-rate threshold (0..1)",
      String(DEFAULT_THRESHOLD),
    )
    .option("--json <file>", "also write full results as JSON to a file")
    .option("--ci", "exit non-zero on any failure or unwritten case")
    .action(runCommand);

  program
    .command("init <skill> [file]")
    .description(
      "Scaffold a cases file for a skill (template + guidance; you write the cases)",
    )
    .action(initCommand);

  program
    .command("new <skill> [dir]")
    .description(
      "Scaffold a new skill directory with a starter SKILL.md (template + guidance)",
    )
    .action(newCommand);

  program
    .command("lint [targets...]")
    .description(
      "Lint SKILL.md files: packaging errors + authoring-guidance warnings",
    )
    .action(lintCommand);

  program
    .command("fmt [targets...]")
    .description("Normalise SKILL.md frontmatter and whitespace")
    .option("--check", "report files that would change, without writing")
    .action(fmtCommand);

  program.parseAsync();
}

/**
 * The default command: discover, run, report.
 *
 * @param {string | undefined} target
 * @param {Record<string, string | boolean | undefined>} options
 * @returns {Promise<void>}
 */
async function runCommand(target, options) {
  const { suites, skipped } = collectSuites(
    typeof target === "string" ? target : undefined,
    /** @type {string | undefined} */ (options.filter),
  );
  for (const { file, error } of skipped) {
    console.error(pc.red(`skip ${file}: ${error.message}`));
  }
  if (suites.length === 0) {
    console.error(
      pc.yellow(
        "no eval suites found (looked for *.eval.yaml / evals/cases.yaml)",
      ),
    );
    process.exit(options.ci ? 1 : 0);
  }

  /** @type {import('./run.js').RunConfig} */
  const config = {
    concurrency: Number(options.concurrency),
    threshold: Number(options.threshold),
    model: /** @type {string | undefined} */ (options.model),
  };
  const runOnce = () => executeAndReport(suites, config, options);

  if (options.watch) {
    await watch(suites, runOnce);
    return;
  }
  const summary = await runOnce();
  const failed = summary.fail > 0 || (Boolean(options.ci) && summary.todo > 0);
  process.exit(failed ? 1 : 0);
}

/**
 * Run all suites once and print the report + summary.
 *
 * @param {import('./types.js').Suite[]} suites
 * @param {import('./run.js').RunConfig} config
 * @param {Record<string, string | boolean | undefined>} options
 * @returns {Promise<import('./report.js').Summary>}
 */
async function executeAndReport(suites, config, options) {
  const results = await runSuites(suites, {
    ...config,
    onProgress: (done, total) =>
      process.stdout.write(`\r${pc.dim(`running ${done}/${total}…`)}   `),
  });
  process.stdout.write(`\r${" ".repeat(30)}\r`); // clear progress line

  const reporter = /** @type {string} */ (options.reporter);
  const rendered = render(results, reporter);
  const summary = summarize(results);
  console.log(rendered);
  console.log(renderSummary(summary));

  if (typeof options.json === "string") {
    fs.writeFileSync(
      options.json,
      reporter === "json" ? rendered : render(results, "json"),
    );
    console.log(pc.dim(`\nwrote ${options.json}`));
  }
  return summary;
}

/**
 * The `init` command.
 *
 * @param {string} skill
 * @param {string} [file]
 * @returns {void}
 */
function initCommand(skill, file) {
  try {
    const { file: created, source } = initSuite(skill, file);
    console.log(
      pc.green(`created ${created}`) + pc.dim(`  (skill: ${source})`),
    );
    console.log(pc.dim(`edit it, then: skillevel ${skill}`));
  } catch (error) {
    exitWith(error);
  }
}

/**
 * The `new` command.
 *
 * @param {string} skill
 * @param {string} [dir]
 * @returns {void}
 */
function newCommand(skill, dir) {
  try {
    const { file } = newSkill(skill, dir);
    console.log(pc.green(`created ${file}`));
    console.log(
      pc.dim(
        `edit SKILL.md, then: skillevel init ${skill} && skillevel ${skill}`,
      ),
    );
  } catch (error) {
    exitWith(error);
  }
}

/**
 * The `lint` command.
 *
 * @param {string[]} targets
 * @returns {void}
 */
function lintCommand(targets) {
  const files = resolveSkillMdsOrExit(targets);
  let errors = 0;
  let warnings = 0;
  for (const file of files) {
    const { problems } = lintSkillMd(file);
    if (problems.length === 0) {
      console.log(`${pc.green("✓")} ${file}`);
      continue;
    }
    console.log(file);
    for (const { severity, rule, message } of problems) {
      const paint = severity === "error" ? pc.red : pc.yellow;
      console.log(`  ${paint(`${severity} ${rule}`)} — ${message}`);
      if (severity === "error") errors += 1;
      else warnings += 1;
    }
  }
  const parts = [
    countFiles(files.length),
    errors ? pc.red(`${errors} errors`) : pc.dim("0 errors"),
    warnings ? pc.yellow(`${warnings} warnings`) : pc.dim("0 warnings"),
  ];
  console.log(`\n${parts.join(pc.dim(" · "))}`);
  process.exit(errors > 0 ? 1 : 0);
}

/**
 * The `fmt` command.
 *
 * @param {string[]} targets
 * @param {{ check?: boolean }} options
 * @returns {void}
 */
function fmtCommand(targets, options) {
  const files = resolveSkillMdsOrExit(targets);
  let changed = 0;
  let unreadable = 0;
  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch (error) {
      console.error(
        pc.red(`cannot read ${file}: ${/** @type {Error} */ (error).message}`),
      );
      unreadable += 1;
      continue;
    }
    const formatted = formatSkillMd(source);
    if (formatted === source) continue; // untouched — no mtime churn
    changed += 1;
    if (options.check) {
      console.log(pc.yellow(`would format ${file}`));
    } else {
      fs.writeFileSync(file, formatted);
      console.log(pc.green(`formatted ${file}`));
    }
  }
  if (changed === 0 && unreadable === 0) {
    console.log(pc.dim(`${countFiles(files.length)} already formatted`));
  }
  process.exit(unreadable > 0 || (options.check && changed > 0) ? 1 : 0);
}

/**
 * Resolve lint/fmt targets to `SKILL.md` paths (see `resolveSkillMds`), or
 * print the failure and exit.
 *
 * @param {string[]} targets
 * @returns {string[]}
 */
function resolveSkillMdsOrExit(targets) {
  try {
    return resolveSkillMds(targets);
  } catch (error) {
    return exitWith(error);
  }
}

/**
 * Print the error message in red and exit 1 — the shared command epilogue.
 *
 * @param {unknown} error
 * @returns {never}
 */
function exitWith(error) {
  console.error(pc.red(/** @type {Error} */ (error).message));
  process.exit(1);
}

/**
 * "1 file" / "3 files".
 *
 * @param {number} n
 * @returns {string}
 */
function countFiles(n) {
  return `${n} file${n === 1 ? "" : "s"}`;
}

/**
 * Watch the suites (and their SKILL.md files) and re-run on change.
 *
 * @param {import('./types.js').Suite[]} suites
 * @param {() => Promise<unknown>} runOnce
 * @returns {Promise<never>}
 */
async function watch(suites, runOnce) {
  const rerun = async () => {
    console.clear();
    console.log(
      pc.dim(`skillevel --watch  ·  ${new Date().toLocaleTimeString()}`),
    );
    await runOnce();
    console.log(pc.dim("\nwatching for changes… (ctrl-c to quit)"));
  };

  await rerun();

  /** @type {NodeJS.Timeout | null} */
  let debounce = null;
  const onChange = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(rerun, WATCH_DEBOUNCE_MS);
  };
  for (const filePath of watchTargets(suites)) {
    try {
      fs.watch(filePath, onChange);
    } catch {
      // not all files are watchable on all platforms — ignore
    }
  }
  return new Promise(() => {}); // keep the process alive
}

/**
 * The files worth watching: each suite file and each skill's SKILL.md.
 *
 * @param {import('./types.js').Suite[]} suites
 * @returns {string[]}
 */
function watchTargets(suites) {
  const targets = new Set();
  for (const suite of suites) {
    if (suite.file) targets.add(suite.file);
  }
  for (const skill of new Set(suites.map((suite) => suite.skill))) {
    const meta = findSkill(skill);
    if (meta) targets.add(meta.path);
  }
  return [...targets];
}
