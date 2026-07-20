/**
 * The `bench` command: run each benchable case in two arms, grade both
 * outputs, report the difference. Three baselines exist:
 *
 * - default — skill available vs the Skill tool blocked outright ("this
 *   skill vs no skills at all").
 * - `--isolate` — per-skill ablation in materialized temp projects: the
 *   "with" arm sees every discoverable skill, the "without" arm every skill
 *   except the target; siblings free to fire in both arms. `--skill-dir`
 *   additionally swaps the target for an uncommitted working copy (and
 *   implies `--isolate`).
 * - `--vs <ref>` — old vs new: the same skill as it was at a git ref versus
 *   the current (or `--skill-dir`) version, siblings identical in both arms.
 *   Answers "did this edit actually improve the skill?"; gate with
 *   `--min-improvement`.
 */

import pc from "picocolors";
import {
  benchSuites,
  type ArmProjects,
  type BenchConfig,
} from "../core/bench-runner.js";
import { summarizeBench } from "../core/summary.js";
import {
  renderBench,
  renderBenchSummary,
  type VsMode,
} from "../report/render.js";
import type { Suite } from "../core/types.js";
import {
  collectSkillDirs,
  materializeProject,
  removeProject,
  resolveSkillDir,
} from "../suite/isolate.js";
import { snapshotSkillDir } from "../suite/snapshot.js";
import type { CommandContext, CommandIo } from "./context.js";
import {
  loadSuitesOrReport,
  rejectSuiteCwds,
  reportError,
  writeJson,
} from "./helpers.js";

export interface BenchCommandOptions {
  filter?: string;
  concurrency?: number;
  model?: string;
  trials?: number;
  json?: string;
  /** Exit non-zero when overall lift is below this many percentage points. */
  minLift?: number;
  /** Per-skill ablation in isolated temp projects instead of blocking all skills. */
  isolate?: boolean;
  /** Bench the working-copy skill at this path (implies `isolate`). */
  skillDir?: string;
  /** Git ref to bench the current version against (old vs new). */
  vs?: string;
  /** Exit non-zero when the `--vs` delta is below this many percentage points. */
  minImprovement?: number;
}

/** Returns the process exit code. */
export async function benchCommand(
  target: string | undefined,
  options: BenchCommandOptions,
  ctx: CommandContext,
): Promise<number> {
  const suites = loadSuitesOrReport(ctx.io, target, options.filter);
  if (!suites) return 0;

  const vs: VsMode | undefined = options.vs
    ? {
        ref: options.vs,
        newSource: options.skillDir
          ? `working copy at ${options.skillDir}`
          : "working copy",
      }
    : undefined;

  const cleanup: string[] = [];
  let isolation: BenchConfig["isolation"];
  if (vs || options.isolate || options.skillDir) {
    if (rejectSuiteCwds(ctx.io, suites, vs ? "--vs" : "--isolate")) return 1;
    try {
      isolation = buildIsolation(suites, options.skillDir, options.vs, cleanup);
    } catch (error) {
      cleanup.forEach(removeProject);
      return reportError(ctx.io, error);
    }
    describeArms(ctx.io, options.skillDir, vs);
  }

  let results;
  try {
    results = await ctx.withProgress((onProgress) =>
      benchSuites(suites, ctx.runner, {
        trials: options.trials,
        concurrency: options.concurrency,
        model: options.model,
        isolation,
        onProgress,
      }),
    );
  } catch (error) {
    return reportError(ctx.io, error);
  } finally {
    cleanup.forEach(removeProject);
  }

  ctx.io.out(renderBench(results, vs));
  const summary = summarizeBench(results);
  ctx.io.out(renderBenchSummary(summary, vs));
  const mode = vs ? "vs-ref" : isolation ? "ablate" : "vs-baseline";
  writeJson(
    ctx.io,
    options.json,
    results.map((suite) => ({
      mode,
      ...(vs ? { ref: vs.ref } : {}),
      ...suite,
    })),
  );

  // In vs mode the same number is a delta vs the old version; gate on
  // whichever threshold fits the mode.
  const gate = vs ? options.minImprovement : options.minLift;
  const failed =
    gate !== undefined && (summary.benched === 0 || summary.liftPp < gate);
  return failed ? 1 : 0;
}

/**
 * Materialize the isolated projects for either mode. The "with" arm always
 * holds every discoverable skill (working copy winning when `--skill-dir` is
 * given). The "without" arm, per target skill, holds every skill except the
 * target (ablation) — or, with `vsRef`, every skill with the target replaced
 * by its snapshot at that ref (old vs new). Registers every temp dir in
 * `cleanup`.
 *
 * @throws {Error} When a benched skill cannot be found, or its old version
 *   cannot be read from git.
 */
function buildIsolation(
  suites: Suite[],
  skillDir: string | undefined,
  vsRef: string | undefined,
  cleanup: string[],
): (skill: string) => ArmProjects {
  const skills = collectSkillDirs();
  if (skillDir) {
    const override = resolveSkillDir(skillDir);
    skills.set(override.name, override.dir);
  }

  const targets = [...new Set(suites.map((suite) => suite.skill))];
  for (const targetSkill of targets) {
    if (!skills.has(targetSkill)) {
      throw new Error(
        `skill '${targetSkill}' not found in this repo or ~/.claude/skills — nothing to ${vsRef ? "compare" : "ablate"}`,
      );
    }
  }

  const withCwd = materializeProject(skills);
  cleanup.push(withCwd);
  const projects = new Map<string, ArmProjects>();
  for (const targetSkill of targets) {
    const other = new Map(skills);
    if (vsRef) {
      const snapshot = snapshotSkillDir(
        skills.get(targetSkill)!,
        vsRef,
        targetSkill,
      );
      cleanup.push(snapshot);
      other.set(targetSkill, snapshot);
    } else {
      other.delete(targetSkill);
    }
    const withoutCwd = materializeProject(other);
    cleanup.push(withoutCwd);
    projects.set(targetSkill, { withCwd, withoutCwd });
  }
  return (skill) => projects.get(skill)!;
}

/** Say what the two arms are, so the numbers can't be misread. */
function describeArms(
  io: CommandIo,
  skillDir: string | undefined,
  vs: VsMode | undefined,
): void {
  if (vs) {
    io.out(
      pc.dim(`old vs new — new: ${vs.newSource}; old: snapshot at ${vs.ref}`),
    );
    return;
  }
  const withArm = skillDir
    ? `with arm: working copy at ${skillDir}`
    : "with arm: all skills";
  io.out(
    pc.dim(
      `isolated ablation — ${withArm}; without arm: every skill except the target`,
    ),
  );
}
