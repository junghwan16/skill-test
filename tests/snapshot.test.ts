import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotSkillDir } from "../src/suite/snapshot.js";
import { withTempDir, write } from "./helpers.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { stdio: "pipe" },
  );
}

function commitAll(repo: string): void {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "snapshot");
}

describe("snapshotSkillDir", () => {
  it("materializes the version at the ref, including since-deleted files", () => {
    withTempDir((repo) => {
      git(repo, "init", "-q");
      write(repo, "skills/sql/SKILL.md", "old body");
      write(repo, "skills/sql/references/gone.md", "old ref");
      commitAll(repo);
      // Mutate the working tree after the commit — the snapshot must not see it.
      write(repo, "skills/sql/SKILL.md", "new body");
      write(repo, "skills/sql/references/added.md", "new ref");
      fs.rmSync(path.join(repo, "skills/sql/references/gone.md"));

      const snap = snapshotSkillDir(
        path.join(repo, "skills/sql"),
        "HEAD",
        "sql",
      );
      try {
        expect(fs.readFileSync(path.join(snap, "SKILL.md"), "utf8")).toBe(
          "old body",
        );
        expect(
          fs.readFileSync(path.join(snap, "references/gone.md"), "utf8"),
        ).toBe("old ref");
        expect(fs.existsSync(path.join(snap, "references/added.md"))).toBe(
          false,
        );
      } finally {
        fs.rmSync(snap, { recursive: true, force: true });
      }
    });
  });

  it("errors when the skill did not exist at the ref", () => {
    withTempDir((repo) => {
      git(repo, "init", "-q");
      write(repo, "keep.md", "x");
      commitAll(repo);
      write(repo, "brand-new/SKILL.md", "x");
      expect(() =>
        snapshotSkillDir(path.join(repo, "brand-new"), "HEAD", "brand-new"),
      ).toThrow(/'brand-new' did not exist at 'HEAD'/);
    });
  });

  it("errors outside a git working tree", () => {
    withTempDir((dir) => {
      write(dir, "sql/SKILL.md", "x");
      expect(() =>
        snapshotSkillDir(path.join(dir, "sql"), "HEAD", "sql"),
      ).toThrow(/not inside a git working tree/);
    });
  });

  it("errors on an unknown ref, quoting git's reason", () => {
    withTempDir((repo) => {
      git(repo, "init", "-q");
      write(repo, "sql/SKILL.md", "x");
      commitAll(repo);
      expect(() =>
        snapshotSkillDir(path.join(repo, "sql"), "no-such-ref", "sql"),
      ).toThrow(/cannot read 'no-such-ref'/);
    });
  });
});
