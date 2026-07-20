/**
 * Shared test doubles: a scripted AgentRunner, an in-memory CommandIo, and a
 * throwaway directory per test.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AgentRunner,
  AgentRunOptions,
} from "../src/agent/agent-runner.js";
import type { CommandContext, CommandIo } from "../src/commands/context.js";
import { noProgress } from "../src/commands/context.js";
import type { RunOutcome } from "../src/core/types.js";

/** A complete outcome with overridable fields. */
export function outcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    text: "",
    skillsFired: [],
    toolsUsed: [],
    costUsd: 0,
    numTurns: 1,
    stoppedEarly: false,
    isError: false,
    ...overrides,
  };
}

export interface RecordedCall {
  prompt: string;
  options: AgentRunOptions;
}

/**
 * An AgentRunner that answers from a script instead of spawning `claude`.
 * The script sees the prompt and options and returns the outcome; every call
 * is recorded for assertions.
 */
export class FakeRunner implements AgentRunner {
  readonly calls: RecordedCall[] = [];

  constructor(
    private readonly script: (
      prompt: string,
      options: AgentRunOptions,
    ) => RunOutcome | Promise<RunOutcome>,
  ) {}

  async run(
    prompt: string,
    options: AgentRunOptions = {},
  ): Promise<RunOutcome> {
    this.calls.push({ prompt, options });
    return this.script(prompt, options);
  }
}

/** A runner that returns the same outcome for every call. */
export function constantRunner(result: RunOutcome): FakeRunner {
  return new FakeRunner(() => result);
}

/** Captures out/err lines for assertions. */
export class MemoryIo implements CommandIo {
  readonly outLines: string[] = [];
  readonly errLines: string[] = [];

  out(line: string): void {
    this.outLines.push(line);
  }

  err(line: string): void {
    this.errLines.push(line);
  }

  get stdout(): string {
    return this.outLines.join("\n");
  }

  get stderr(): string {
    return this.errLines.join("\n");
  }
}

/** A full command context around a fake runner and in-memory io. */
export function testContext(
  runner: AgentRunner,
): CommandContext & { io: MemoryIo } {
  return { io: new MemoryIo(), runner, withProgress: noProgress };
}

/** A fresh temp directory, removed after `fn` finishes. */
export function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skilltree-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Write a file under `dir`, creating parent directories. */
export function write(dir: string, rel: string, content: string): string {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
