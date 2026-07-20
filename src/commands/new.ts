/**
 * The `new` command: one on-ramp. Scaffolds the pieces the skill is missing —
 * a `SKILL.md` when the skill exists nowhere (locally or installed), and a
 * cases file when there is none — and skips what's already there.
 */

import fs from "node:fs";
import pc from "picocolors";
import { initSuite, newSkill } from "../skill-md/scaffold.js";
import { findSkill } from "../suite/resolve.js";
import type { CommandContext } from "./context.js";
import { reportError } from "./helpers.js";

/** Returns the process exit code. */
export function newCommand(
  skill: string,
  dir: string | undefined,
  ctx: CommandContext,
): number {
  const { io } = ctx;
  try {
    const existing = findSkill(skill);
    if (existing) {
      io.out(pc.dim(`skill exists — ${existing.path} (${existing.source})`));
    } else {
      const { file } = newSkill(skill, dir);
      io.out(pc.green(`created ${file}`));
    }

    const evalFile = `${skill}.eval.yaml`;
    if (fs.existsSync(evalFile)) {
      io.out(pc.dim(`cases exist — ${evalFile}`));
    } else {
      const { file } = initSuite(skill, evalFile);
      io.out(pc.green(`created ${file}`));
    }

    io.out(
      pc.dim(
        `write the content, then: skilltree ${skill}  ·  skilltree bench ${skill}`,
      ),
    );
    return 0;
  } catch (error) {
    return reportError(io, error);
  }
}
