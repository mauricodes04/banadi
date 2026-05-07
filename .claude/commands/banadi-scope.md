---
description: Scope — print config/scope.yml, or test a target against it
---

Argument: `[target]` — optional. Without it, prints the loaded scope file. With it, tests whether the target is in scope.

## Steps

1. Load `modes/_shared.md` then `modes/utility/scope.md`.
2. No arg: `node lib/scope.mjs` → prints `{ path, entries }` on stdout. Present entries to operator as a short table (value, authorization).
3. With arg: `node lib/scope.mjs <target>` → prints `{ matched, entry, scope_path }`. Report:
   - matched → one-line confirmation with the authorization note from the matching entry.
   - unmatched → one-line warning that the target is out of scope per the loaded file, and a reminder that phase commands will warn-and-proceed, not refuse.

## Do not

- Refuse anything based on scope outcome; this command is informational only.
