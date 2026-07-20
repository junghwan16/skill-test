/**
 * End-to-end command tests, fully offline: real YAML on disk, a fake agent
 * runner, in-memory io — exactly what a user sees, minus the `claude` spend.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { benchCommand } from "../src/commands/bench.js";
import { runCommand } from "../src/commands/run.js";
import { validateCommand } from "../src/commands/validate.js";
import { FakeRunner, constantRunner, outcome, testContext } from "./helpers.js";

let dir: string;
let previousCwd: string;

beforeEach(() => {
  previousCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "skilltree-cmd-"));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeSuite(name: string, yaml: string): void {
  fs.writeFileSync(path.join(dir, name), yaml);
}

const SUITE = [
  "skill: sql",
  "trials: 2",
  "cases:",
  "  - id: happy-1",
  "    prompt: write a query",
  "    should_trigger: true",
  "  - id: todo-1",
  "    prompt: '<unwritten>'",
  "    should_trigger: true",
].join("\n");

describe("runCommand", () => {
  it("exits 0 and prints the grid when every case passes", async () => {
    writeSuite("sql.eval.yaml", SUITE);
    const ctx = testContext(constantRunner(outcome({ skillsFired: ["sql"] })));
    const code = await runCommand(undefined, {}, ctx);
    expect(code).toBe(0);
    expect(ctx.io.stdout).toContain("happy-1");
    expect(ctx.io.stdout).toContain("2/2");
    expect(ctx.io.stdout).toContain("TODO — unwritten");
    expect(ctx.io.stdout).toContain("1 passed");
  });

  it("exits 1 when a case fails", async () => {
    writeSuite("sql.eval.yaml", SUITE);
    const ctx = testContext(constantRunner(outcome({ skillsFired: [] })));
    expect(await runCommand(undefined, {}, ctx)).toBe(1);
    expect(ctx.io.stdout).toContain("1 failed");
  });

  it("--ci makes todo cases fail the run", async () => {
    writeSuite("sql.eval.yaml", SUITE);
    const passing = testContext(
      constantRunner(outcome({ skillsFired: ["sql"] })),
    );
    expect(await runCommand(undefined, { ci: true }, passing)).toBe(1);
  });

  it("empty discovery fails only under --ci", async () => {
    const empty = testContext(constantRunner(outcome()));
    expect(await runCommand(undefined, { ci: true }, empty)).toBe(1);
    expect(await runCommand(undefined, { ci: false }, empty)).toBe(0);
    expect(empty.io.stderr).toContain("no eval suites found");
  });

  it("writes machine-readable results with --json", async () => {
    writeSuite("sql.eval.yaml", SUITE);
    const ctx = testContext(constantRunner(outcome({ skillsFired: ["sql"] })));
    await runCommand(undefined, { json: "out.json" }, ctx);
    const results = JSON.parse(fs.readFileSync("out.json", "utf8"));
    expect(results[0].skill).toBe("sql");
    expect(results[0].cases).toHaveLength(2);
  });

  it("reports a runner failure as a clean error, not a stack trace", async () => {
    writeSuite("sql.eval.yaml", SUITE);
    const ctx = testContext(
      new FakeRunner(() => {
        throw new Error("`claude` CLI not found on PATH");
      }),
    );
    expect(await runCommand(undefined, {}, ctx)).toBe(1);
    expect(ctx.io.stderr).toContain("`claude` CLI not found");
  });

  it("--skill-dir evals the working copy in an isolated project, then cleans up", async () => {
    writeSuite("sql.eval.yaml", SUITE);
    // Folder named differently from the skill — the frontmatter name wins.
    fs.mkdirSync(path.join(dir, "wip"));
    fs.writeFileSync(
      path.join(dir, "wip", "SKILL.md"),
      "---\nname: sql\ndescription: d\n---\nbody\n",
    );
    const seen: string[] = [];
    const runner = new FakeRunner((_prompt, options) => {
      seen.push(options.cwd!);
      const materialized = fs.existsSync(
        path.join(options.cwd!, ".claude", "skills", "sql", "SKILL.md"),
      );
      return outcome({
        skillsFired: materialized && options.isolate ? ["sql"] : [],
      });
    });
    const ctx = testContext(runner);
    expect(await runCommand(undefined, { skillDir: "wip" }, ctx)).toBe(0);
    expect(ctx.io.stdout).toContain("1 passed");
    expect(fs.existsSync(seen[0]!)).toBe(false); // temp project removed
  });

  it("--skill-dir refuses suites that declare their own cwd", async () => {
    writeSuite("sql.eval.yaml", `cwd: .\n${SUITE}`);
    fs.mkdirSync(path.join(dir, "sql-skill"));
    fs.writeFileSync(path.join(dir, "sql-skill", "SKILL.md"), "x");
    const ctx = testContext(constantRunner(outcome()));
    expect(await runCommand(undefined, { skillDir: "sql-skill" }, ctx)).toBe(1);
    expect(ctx.io.stderr).toContain("conflicts with --skill-dir");
  });

  it("--skill-dir reports a bad path cleanly", async () => {
    writeSuite("sql.eval.yaml", SUITE);
    const ctx = testContext(constantRunner(outcome()));
    expect(await runCommand(undefined, { skillDir: "missing" }, ctx)).toBe(1);
    expect(ctx.io.stderr).toContain("no SKILL.md");
  });
});

describe("benchCommand", () => {
  const BENCH_SUITE = [
    "skill: sql",
    "cases:",
    "  - id: happy-1",
    "    prompt: write a query",
    "    should_trigger: true",
    "    expect:",
    "      - match: SELECT",
  ].join("\n");

  it("reports the lift and honours --min-lift", async () => {
    writeSuite("sql.eval.yaml", BENCH_SUITE);
    const runner = new FakeRunner((_prompt, options) =>
      outcome({ text: options.disallowSkills ? "dunno" : "SELECT 1" }),
    );
    const ctx = testContext(runner);
    expect(await benchCommand(undefined, { trials: 2 }, ctx)).toBe(0);
    expect(ctx.io.stdout).toContain("skill lift");
    expect(ctx.io.stdout).toContain("+100pp");

    const flat = testContext(constantRunner(outcome({ text: "SELECT 1" })));
    expect(
      await benchCommand(undefined, { trials: 2, minLift: 10 }, flat),
    ).toBe(1);
  });

  it("exits 1 with --min-lift when nothing is benchable", async () => {
    writeSuite(
      "sql.eval.yaml",
      "skill: sql\ncases:\n  - id: a\n    prompt: p\n    should_trigger: true",
    );
    const ctx = testContext(constantRunner(outcome()));
    expect(await benchCommand(undefined, { minLift: 1 }, ctx)).toBe(1);
    expect(ctx.io.stdout).toContain("nothing to bench");
  });

  it("--isolate ablates only the target skill and cleans up its projects", async () => {
    writeSuite("sql.eval.yaml", BENCH_SUITE);
    fs.mkdirSync(path.join(dir, "sql"));
    fs.writeFileSync(path.join(dir, "sql", "SKILL.md"), "the skill");
    const seen = new Set<string>();
    const runner = new FakeRunner((_prompt, options) => {
      seen.add(options.cwd!);
      expect(options.disallowSkills).toBeUndefined();
      const hasTarget = fs.existsSync(
        path.join(options.cwd!, ".claude", "skills", "sql", "SKILL.md"),
      );
      return outcome({ text: hasTarget ? "SELECT 1" : "dunno" });
    });
    const ctx = testContext(runner);
    expect(
      await benchCommand(undefined, { isolate: true, trials: 2 }, ctx),
    ).toBe(0);
    expect(ctx.io.stdout).toContain("isolated ablation");
    expect(ctx.io.stdout).toContain("+100pp");
    expect(seen.size).toBe(2); // one project per arm
    for (const cwd of seen) expect(fs.existsSync(cwd)).toBe(false);
  });

  it("--isolate fails clearly when the target skill cannot be found", async () => {
    writeSuite(
      "zz.eval.yaml",
      BENCH_SUITE.replace("skill: sql", "skill: zz-no-such-skill"),
    );
    const ctx = testContext(constantRunner(outcome()));
    expect(await benchCommand(undefined, { isolate: true }, ctx)).toBe(1);
    expect(ctx.io.stderr).toContain("nothing to ablate");
  });

  function gitHere(...args: string[]): void {
    execFileSync(
      "git",
      ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { stdio: "pipe" },
    );
  }

  /** A committed old version of `sql/SKILL.md`, then a working-copy edit. */
  function writeEditedSkillRepo(): void {
    writeSuite("sql.eval.yaml", BENCH_SUITE);
    fs.mkdirSync(path.join(dir, "sql"));
    fs.writeFileSync(path.join(dir, "sql", "SKILL.md"), "old instructions");
    gitHere("init", "-q");
    gitHere("add", "-A");
    gitHere("commit", "-q", "-m", "old");
    fs.writeFileSync(path.join(dir, "sql", "SKILL.md"), "new instructions");
  }

  /** Passes only in arms whose materialized target SKILL.md matches `winner`. */
  function versionSensitiveRunner(winner: string): FakeRunner {
    return new FakeRunner((_prompt, options) => {
      expect(options.disallowSkills).toBeUndefined();
      expect(options.isolate).toBe(true);
      const skillMd = path.join(
        options.cwd!,
        ".claude",
        "skills",
        "sql",
        "SKILL.md",
      );
      const body = fs.existsSync(skillMd)
        ? fs.readFileSync(skillMd, "utf8")
        : "";
      return outcome({ text: body.includes(winner) ? "SELECT 1" : "dunno" });
    });
  }

  it("--vs benches the working copy against the snapshot at a ref", async () => {
    writeEditedSkillRepo();
    const runner = versionSensitiveRunner("new");
    const ctx = testContext(runner);
    expect(await benchCommand(undefined, { vs: "HEAD", trials: 2 }, ctx)).toBe(
      0,
    );
    expect(ctx.io.stdout).toContain("old vs new");
    expect(ctx.io.stdout).toContain("old: HEAD");
    expect(ctx.io.stdout).toContain("improvement");
    expect(ctx.io.stdout).toContain("+100pp");
    const cwds = new Set(runner.calls.map((c) => c.options.cwd!));
    expect(cwds.size).toBe(2); // one project per version
    for (const cwd of cwds) expect(fs.existsSync(cwd)).toBe(false);
  });

  it("--min-improvement fails the run when the edit regressed", async () => {
    writeEditedSkillRepo();
    const ctx = testContext(versionSensitiveRunner("old"));
    expect(
      await benchCommand(
        undefined,
        { vs: "HEAD", trials: 1, minImprovement: 0 },
        ctx,
      ),
    ).toBe(1);
    expect(ctx.io.stdout).toContain("-100pp");
  });

  it("--vs outside a git repo fails cleanly", async () => {
    writeSuite("sql.eval.yaml", BENCH_SUITE);
    fs.mkdirSync(path.join(dir, "sql"));
    fs.writeFileSync(path.join(dir, "sql", "SKILL.md"), "x");
    const ctx = testContext(constantRunner(outcome()));
    expect(await benchCommand(undefined, { vs: "HEAD" }, ctx)).toBe(1);
    expect(ctx.io.stderr).toContain("not inside a git working tree");
  });
});

describe("validateCommand", () => {
  it("previews run counts offline without touching the runner", () => {
    writeSuite("sql.eval.yaml", SUITE);
    const runner = constantRunner(outcome());
    const ctx = testContext(runner);
    expect(validateCommand(undefined, {}, ctx)).toBe(0);
    expect(runner.calls).toHaveLength(0);
    expect(ctx.io.stdout).toContain("1 happy");
    expect(ctx.io.stdout).toContain("1 todo");
    expect(ctx.io.stdout).toContain("≈ 2 claude run(s)");
  });

  it("exits 1 when a file fails to parse", () => {
    writeSuite("bad.eval.yaml", "cases: []");
    const ctx = testContext(constantRunner(outcome()));
    expect(validateCommand(undefined, {}, ctx)).toBe(1);
    expect(ctx.io.stderr).toContain("missing 'skill'");
  });
});
