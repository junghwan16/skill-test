/**
 * Pure template rendering for the `new` scaffolder — string in, string out,
 * no fs. Offline and deterministic: placeholders plus distilled authoring
 * guidance, never invented content (auto-generated tests plant
 * plausible-but-wrong checks).
 */

import type { SkillMeta } from "../suite/resolve.js";

const COMMENT_WRAP_WIDTH = 72;

/** The starter `SKILL.md` body. */
export function renderSkillTemplate(skill: string): string {
  return `---
name: ${skill}
description: TODO — what this skill does AND when to use it. State the concrete trigger contexts and phrases; keep it free of angle brackets.
---

<!--
Authoring guide (delete this comment when done):

- The description above is the PRIMARY triggering mechanism. State what the
  skill does AND the concrete contexts where it applies. Claude tends to
  under-trigger skills, so be a little "pushy" — list the trigger phrases a
  real user would type.
- ALL "when to use" information belongs in the description, not the body.
  The body is only loaded after the skill has already triggered.
- Keep SKILL.md under 500 lines. If you need more, layer it (progressive
  disclosure): references/ for docs loaded as needed, scripts/ for executable
  helpers, assets/ for files used in output.
- Write instructions in imperative form. Explain WHY things matter instead of
  heavy-handed MUSTs — the model reasons better from rationale than rules.
- After writing, fill in the cases in ${skill}.eval.yaml and test triggering:
    skilltree ${skill}
  then measure whether the skill actually improves the output:
    skilltree bench ${skill}
-->

# ${skill}

TODO — one-paragraph overview: what this skill helps with and the outcome it
produces.

## Instructions

TODO — the steps or principles Claude should follow, in imperative form.

## Examples

TODO — one or two realistic input/output examples (optional; delete if the
instructions stand on their own).
`;
}

/** The starter cases file body. */
export function renderSuiteTemplate(
  skill: string,
  meta: SkillMeta | null,
): string {
  return `# ${skill}.eval.yaml — skilltree test cases
# new scaffolded this. Delete the examples and write your own cases.
#
# Principles (authoring guide):
#   - Start with 5 happy + 5 negative — never skip negatives (over-trigger check)
#   - Negatives should be near-misses ("adjacent but must NOT fire"); obvious
#     unrelated prompts are weak
#   - Real usage / production traces make the best cases — paste them in
#   - Judge the result, not the path — not "loaded on turn 1", but "did the task"
#   - Happy cases with match/absent/judge also power \`skilltree bench ${skill}\`
#     (skill-on vs skill-off lift — does the skill actually help?)
${triggerHint(skill, meta)}
skill: ${skill}
trials: 5

cases:
  # -- happy (should fire) — replace the example with 5 real ones -----------
  - id: happy-1
    prompt: "<a realistic prompt a user would send that SHOULD trigger this skill>"
    should_trigger: true
    expect:
      - triggered
      # - match: "<regex the response should contain, e.g. a tool or table name>"

  # happy-2 ... happy-5

  # -- negative (must NOT fire — near-miss) — write 5 real ones -------------
  - id: neg-1
    prompt: "<adjacent to the skill but must NOT trigger it>"
    should_trigger: false
    expect:
      - not_triggered

  # neg-2 ... neg-5
`;
}

/** A comment block hinting at what the skill should trigger on. */
function triggerHint(skill: string, meta: SkillMeta | null): string {
  if (meta?.triggers) {
    return [
      "",
      "# Trigger keywords this skill claims (verbatim from its SKILL.md — weave these",
      "# into happy prompts; make negatives drift just outside them):",
      `#   ${wrapComment(meta.triggers)}`,
      "",
    ].join("\n");
  }
  if (meta) {
    return "\n# (This skill's SKILL.md has no explicit trigger list — read its description.)\n";
  }
  return `\n# NOTE: no SKILL.md found for "${skill}" in this repo or ~/.claude/skills.\n#       Fill in real cases from how you actually use the skill.\n`;
}

/** Word-wrap a string into comment continuation lines. */
function wrapComment(text: string, width = COMMENT_WRAP_WIDTH): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n#   ");
}
