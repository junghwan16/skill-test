---
name: commit-style
description: Write a git commit message in the team's Conventional Commits style from staged or described changes. Use when the user asks for a commit message, says "commit this", or wants a subject line for changes they just made. Not for explaining the format, undoing commits, or writing PR descriptions.
---

# commit-style — Conventional Commits, the team's way

Turn a set of changes into one commit message in Conventional Commits format.
If changes are staged, read `git diff --cached` to see what actually changed;
otherwise work from the user's description. Don't commit — just write the message.

## Format

```
<type>(<scope>): <subject>

<body>
```

- **type** — one of `feat`, `fix`, `refactor`, `chore`, `docs`, `test`,
  `perf`, `build`, `ci`. Pick by what the change does, not the files it touches.
- **scope** — optional; the area affected (a module, package, or surface), in
  lowercase. Omit rather than guess.
- **subject** — imperative mood ("add", not "adds"/"added"), no trailing
  period, ≤ 72 characters. Complete the sentence "This commit will …".
- **body** — optional; wrap at 72 columns. Explain *why*, not *what* the diff
  already shows. Note breaking changes as `BREAKING CHANGE:` in the footer.

## Rules

- One logical change per commit. If the diff spans unrelated changes, say so
  and propose splitting rather than forcing one message.
- A bug fix is `fix:`; a new capability is `feat:`; a pure restructuring that
  keeps behaviour is `refactor:`.
- Prefer the narrowest true type — a formatting-only change is `chore:` or
  `docs:`, not `fix:`.

## Examples

```
fix(payment): guard against null card on retry
feat(auth): add TOTP enrollment endpoint
refactor(parser): extract token scanner from the reader loop
```
