/**
 * @file Locates `SKILL.md` files — by skill name (a working copy under the
 * current directory wins over the installed one), by path, or by walking the
 * tree — and reads the bits `init` needs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkDir } from "./fswalk.js";
import { splitFrontmatter, parseFrontmatter } from "./skillmd.js";
import { MAX_WALK_DEPTH, WALK_SKIP_DIRS } from "./constants.js";

/**
 * @typedef {object} SkillMeta
 * @property {string} path                   Path to the `SKILL.md`.
 * @property {"local" | "installed"} source
 * @property {string} name                   Frontmatter `name`, or the folder name.
 * @property {string} description            Frontmatter `description`.
 * @property {string} [triggers]             Verbatim trigger-keyword line, if any.
 */

/**
 * Find a skill's `SKILL.md`. Prefers a working copy under `root`; falls back to
 * `~/.claude/skills/<name>/SKILL.md`.
 *
 * @param {string} name
 * @param {string} [root]
 * @returns {SkillMeta | null}
 */
export function findSkill(name, root = process.cwd()) {
  const local = findLocalSkillMd(root, name);
  if (local) return readMeta(local, "local");
  const installed = installedSkillMd(name);
  return installed ? readMeta(installed, "installed") : null;
}

/**
 * Resolve lint/fmt targets to `SKILL.md` paths. A target may be a `SKILL.md`
 * path, a directory containing one, or a skill name (resolved like `findSkill`,
 * but without reading the file). With no targets, every `SKILL.md` under
 * `root` is returned.
 *
 * @param {string[]} targets
 * @param {string} [root]
 * @returns {string[]}
 * @throws {Error} When a target cannot be resolved, or discovery finds nothing.
 */
export function resolveSkillMds(targets, root = process.cwd()) {
  if (targets.length === 0) return discoverSkillMds(root);

  /** @type {Map<string, string> | null} */
  let localSkillMds = null; // one walk serves every name target
  return targets.map((target) => {
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      const candidate = path.join(target, "SKILL.md");
      if (fs.existsSync(candidate)) return candidate;
      throw new Error(`${target} does not contain a SKILL.md`);
    }
    if (stat?.isFile()) return target;
    localSkillMds ??= collectLocalSkillMds(root);
    const found = localSkillMds.get(target) ?? installedSkillMd(target);
    if (found) return found;
    throw new Error(
      `cannot resolve "${target}" — not a path, and no skill by that name in this repo or ~/.claude/skills`,
    );
  });
}

/**
 * Every `SKILL.md` under `root`.
 *
 * @param {string} root
 * @returns {string[]} Sorted paths.
 * @throws {Error} When none are found.
 */
function discoverSkillMds(root) {
  const found = [];
  for (const { path: filePath, entry } of skillWalk(root)) {
    if (entry.isFile() && entry.name === "SKILL.md") found.push(filePath);
  }
  if (found.length === 0) {
    throw new Error("no SKILL.md found under the current directory");
  }
  return found.sort();
}

/**
 * Every local skill's `SKILL.md`, keyed by directory name. First hit in walk
 * order wins, matching `findLocalSkillMd`.
 *
 * @param {string} root
 * @returns {Map<string, string>}
 */
function collectLocalSkillMds(root) {
  const map = new Map();
  for (const { path: dirPath, entry } of skillWalk(root)) {
    if (!entry.isDirectory() || map.has(entry.name)) continue;
    const candidate = path.join(dirPath, "SKILL.md");
    if (fs.existsSync(candidate)) map.set(entry.name, candidate);
  }
  return map;
}

/**
 * Find the `SKILL.md` of the first directory named `name` under `root`.
 *
 * @param {string} root
 * @param {string} name
 * @returns {string | null}
 */
function findLocalSkillMd(root, name) {
  for (const { path: dirPath, entry } of skillWalk(root)) {
    if (!entry.isDirectory() || entry.name !== name) continue;
    const candidate = path.join(dirPath, "SKILL.md");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The walk every skill lookup uses.
 *
 * @param {string} root
 * @returns {ReturnType<typeof walkDir>}
 */
function skillWalk(root) {
  return walkDir(root, { skip: WALK_SKIP_DIRS, maxDepth: MAX_WALK_DEPTH });
}

/**
 * The installed `SKILL.md` for `name`, if any.
 *
 * @param {string} name
 * @returns {string | null}
 */
function installedSkillMd(name) {
  const candidate = path.join(
    os.homedir(),
    ".claude",
    "skills",
    name,
    "SKILL.md",
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Read the frontmatter fields `init` uses.
 *
 * @param {string} skillMdPath
 * @param {"local" | "installed"} source
 * @returns {SkillMeta}
 */
function readMeta(skillMdPath, source) {
  const raw = fs.readFileSync(skillMdPath, "utf8");
  let name = path.basename(path.dirname(skillMdPath));
  let description = "";
  let body = raw;

  const block = splitFrontmatter(raw);
  if (block) {
    // On parse failure, keep the folder-name fallback.
    const { data } = parseFrontmatter(block.yaml);
    name = /** @type {string} */ (data?.name ?? name);
    description = /** @type {string} */ (data?.description ?? "");
    body = block.body;
  }

  return {
    path: skillMdPath,
    source,
    name,
    description,
    triggers: extractTriggers(description, body),
  };
}

/**
 * A skill's trigger-keyword line, verbatim, if it declares one. Real skills put
 * it in the description or the body, behind a localized marker — so scan both,
 * strip markdown emphasis, and accept "Triggers", the Korean "트리거", and the
 * Japanese "トリガー". Returns the first list found (a hint, not a contract).
 *
 * @param {string} description
 * @param {string} body
 * @returns {string | undefined}
 */
function extractTriggers(description, body) {
  const text = `${description}\n${body}`.replace(/[*_#>]/g, "");
  const match = text.match(
    /(?:triggers?|트리거(?:\s*키워드)?|トリガー)\s*[:：—–-]\s*(.+)/i,
  );
  return match?.[1]?.trim() || undefined;
}
