/**
 * Git snapshots of a skill directory: materialize the version of a skill at
 * a ref (`git show <ref>:<path>`) into a temp dir, so `bench --vs` can run
 * the old version as one arm without requiring it to still be installed —
 * or to still exist in the working tree at all.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Copy the version of `skillDir` at `ref` into a fresh temp dir and return
 * it. Every file under the directory at that ref is materialized — SKILL.md,
 * `references/`, scripts — so the snapshot behaves like a real skill dir. A
 * file added since `ref` is simply absent, which is correct: that's part of
 * what changed.
 *
 * @throws {Error} When `skillDir` is not inside a git working tree, `ref`
 *   is unknown, or the skill had no SKILL.md at `ref`.
 */
export function snapshotSkillDir(
  skillDir: string,
  ref: string,
  skillName: string,
): string {
  // Realpath both sides: `--show-toplevel` returns a resolved path, and a
  // symlinked tmpdir (macOS) would otherwise break the relative computation.
  const dir = fs.realpathSync(path.resolve(skillDir));
  let repoRoot: string;
  try {
    repoRoot = git(dir, ["rev-parse", "--show-toplevel"]).toString().trim();
  } catch {
    throw new Error(
      `${skillDir} is not inside a git working tree — --vs reads the old version from git history`,
    );
  }

  // Git tree paths always use forward slashes, and "" means the repo root.
  const prefix = path.relative(repoRoot, dir).split(path.sep).join("/");
  let listing: string;
  try {
    listing = git(repoRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      ref,
      "--",
      prefix === "" ? "." : prefix,
    ]).toString();
  } catch (error) {
    throw new Error(
      `cannot read '${ref}' in ${repoRoot}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const files = listing.split("\n").filter(Boolean);
  const strip = prefix === "" ? "" : `${prefix}/`;
  if (!files.includes(`${strip}SKILL.md`)) {
    throw new Error(`skill '${skillName}' did not exist at '${ref}'`);
  }

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "skilltree-snapshot-"));
  try {
    for (const file of files) {
      const target = path.join(out, file.slice(strip.length));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, git(repoRoot, ["show", `${ref}:${file}`]));
    }
  } catch (error) {
    fs.rmSync(out, { recursive: true, force: true });
    throw error;
  }
  return out;
}

/** Run git in `cwd`, returning stdout as a Buffer; throws with git's stderr. */
function git(cwd: string, args: string[]): Buffer {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(stderr || (error as Error).message, { cause: error });
  }
}
