/**
 * Isolated skill projects: a throwaway directory laid out as a Claude Code
 * project (`.claude/skills/<name>/…`) that a run can use as its cwd, so
 * `claude -p` sees exactly the skill set we materialized — nothing more.
 *
 * This is the primitive behind `run --skill-dir` (eval an uncommitted
 * working-copy SKILL.md reproducibly) and `bench --isolate` (true per-skill
 * ablation: the "without" arm keeps every sibling and drops only the target).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_WALK_DEPTH, WALK_SKIP_DIRS } from "../core/constants.js";
import { walkDir } from "../shared/fs-walk.js";
import { parseFrontmatter, splitFrontmatter } from "../skill-md/document.js";

/** A skill to materialize: the name claude will see, and where it lives now. */
export interface SkillSource {
  name: string;
  /** Directory containing the SKILL.md (and references/, scripts/, …). */
  dir: string;
}

/**
 * Resolve a `--skill-dir` argument — a skill directory or a path to its
 * SKILL.md — to a source. The name comes from the frontmatter when present
 * (that is what the Skill tool matches on), else the directory name.
 *
 * @throws {Error} When the path does not lead to a SKILL.md.
 */
export function resolveSkillDir(target: string): SkillSource {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  const dir = stat?.isDirectory() ? target : path.dirname(target);
  const skillMd = path.join(dir, "SKILL.md");
  if (!stat || !fs.existsSync(skillMd)) {
    throw new Error(`--skill-dir ${target}: no SKILL.md found there`);
  }
  return { name: skillName(skillMd), dir };
}

/**
 * Every discoverable skill, keyed by name: working copies under `root` plus
 * the installed `~/.claude/skills/*`. A local skill wins over an installed
 * one of the same name, matching how `findSkill` resolves.
 *
 * Keys are the *frontmatter* name (falling back to the folder name) — that is
 * the identity the Skill tool matches on, and what ablation must delete. A
 * working copy in an oddly-named checkout folder would otherwise slip back in
 * under its folder name.
 */
export function collectSkillDirs(
  root: string = process.cwd(),
  installedRoot: string = path.join(os.homedir(), ".claude", "skills"),
): Map<string, string> {
  const skills = new Map<string, string>();
  for (const entry of readDirs(installedRoot)) {
    const dir = path.join(installedRoot, entry);
    const skillMd = path.join(dir, "SKILL.md");
    if (fs.existsSync(skillMd)) skills.set(skillName(skillMd), dir);
  }
  for (const { path: dirPath, entry } of walkDir(root, {
    skip: WALK_SKIP_DIRS,
    maxDepth: MAX_WALK_DEPTH,
  })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(dirPath, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    const name = skillName(skillMd);
    // First hit in walk order wins, matching findSkill.
    if (!hasLocal(skills, root, name)) skills.set(name, dirPath);
  }
  return skills;
}

/**
 * Copy `skills` into a fresh temp project as `.claude/skills/<name>` and
 * return the project root — the cwd for isolated runs. Symlinked sources are
 * dereferenced so the materialized copy is self-contained.
 */
export function materializeProject(skills: Map<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skilltree-isolated-"));
  for (const [name, dir] of skills) {
    fs.cpSync(dir, path.join(root, ".claude", "skills", name), {
      recursive: true,
      dereference: true,
    });
  }
  return root;
}

/** Remove a materialized project. Safe to call on an already-removed one. */
export function removeProject(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

/** Frontmatter `name`, or the folder name when absent/unparsable. */
function skillName(skillMdPath: string): string {
  const block = splitFrontmatter(fs.readFileSync(skillMdPath, "utf8"));
  const name = block ? parseFrontmatter(block.yaml).data?.name : undefined;
  return typeof name === "string" && name
    ? name
    : path.basename(path.dirname(skillMdPath));
}

/** Whether `skills` already holds a local (under-root) entry for `name`. */
function hasLocal(
  skills: Map<string, string>,
  root: string,
  name: string,
): boolean {
  const existing = skills.get(name);
  return existing !== undefined && existing.startsWith(root + path.sep);
}

/** Directory entries of `dir`, or none when it does not exist. */
function readDirs(dir: string): string[] {
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name);
}
