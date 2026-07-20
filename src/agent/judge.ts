/**
 * The LLM judge: asks a fresh Claude (no skills, one turn) to grade a
 * response against a rubric. Built on the {@link AgentRunner} port so tests
 * can fake the model.
 */

import { DEFAULT_JUDGE_MODEL, JUDGE_TIMEOUT_MS } from "../core/constants.js";
import type { AgentRunner } from "./agent-runner.js";

export interface Verdict {
  ok: boolean;
  reason: string;
}

/** Grades an answer against a rubric question. */
export type Judge = (question: string, answer: string) => Promise<Verdict>;

/** How much of the answer the judge gets to see. */
const MAX_ANSWER_CHARS = 6000;
const MAX_REASON_CHARS = 140;

/** Build a {@link Judge} that runs the rubric through `runner`. */
export function createJudge(runner: AgentRunner, model?: string): Judge {
  return async (question, answer) => {
    const prompt = [
      "You are grading an AI assistant's response against a criterion.",
      `Criterion: ${question}`,
      "",
      "--- RESPONSE ---",
      answer.slice(0, MAX_ANSWER_CHARS),
      "--- END ---",
      "",
      'Reply with exactly "PASS" or "FAIL" as the first word, then a one-line reason.',
    ].join("\n");

    const outcome = await runner.run(prompt, {
      model: model ?? DEFAULT_JUDGE_MODEL,
      maxTurns: 1,
      timeoutMs: JUDGE_TIMEOUT_MS,
    });
    return parseVerdict(outcome.text);
  };
}

/**
 * Extract PASS/FAIL from the judge's reply. The judge is asked to lead with the
 * verdict, but a reasoning model sometimes prepends a line ("Let me check…")
 * before it — so anchoring on the very first character misreads a real PASS as
 * a fail. Scan instead for the first line whose leading token (past any
 * markdown/whitespace) is PASS or FAIL; that line is the verdict, the rest is
 * the reason. If no line leads with a verdict, fall back to an unambiguous
 * mention — and, absent that, fail closed rather than guess.
 */
export function parseVerdict(text: string): Verdict {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^[\s>*_#.)\]-]*\b(pass|fail)\b[:.\s-]*(.*)$/i.exec(lines[i]!);
    if (m) {
      const reason = [m[2], ...lines.slice(i + 1)].join(" ").trim();
      return {
        ok: m[1]!.toLowerCase() === "pass",
        reason: reason.slice(0, MAX_REASON_CHARS),
      };
    }
  }
  const hasPass = /\bpass\b/i.test(text);
  const hasFail = /\bfail\b/i.test(text);
  return {
    ok: hasPass && !hasFail,
    reason: text.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_CHARS),
  };
}
