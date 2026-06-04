// lint-dist.ts — static guard against malformed option specs in dist/_*.
//
//   bun scripts/lint-dist.ts
//
// The smoke test stubs `_arguments`, so it can't see a spec whose option NAME
// contains whitespace — e.g. a tool that prints a *related* flag in its name
// column (gh: `-f, --force --hostname`). Such a name brace-expands to an invalid
// zsh option and errors at completion time, yet `zsh -n` and the smoke test both
// pass. This check fails the build if one reappears. `makeFlag` is what prevents
// it (generator/parsers/shared.ts); this proves it stayed prevented.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve(import.meta.dir, "..", "dist");

// A space among option-name tokens, outside the exclusion list `(…)` and the
// description `[…]`. Two shapes the emitter can produce from a bad name:
//   '…'{-f,--force --hostname}'…'         ← space inside the name brace group
//   '(…)--succeed-on-no-caches --all[…]'  ← space in a lone name before `[`/`:`
// Spaces inside `(…)` (multi-name exclusions) and `[…]` (descriptions) are fine
// and excluded by construction.
const NAME_BRACE_SPACE = /'\{[^}]*\s[^}]*\}'/;
const SINGLE_NAME_SPACE = /['*)](?:\*?-{1,2}[A-Za-z0-9][^'[\]]*\s[^'[\]]*)[[:]/;

const files = readdirSync(DIST).filter((n) => n.startsWith("_"));
let bad = 0;
for (const name of files) {
  const lines = readFileSync(resolve(DIST, name), "utf8").split("\n");
  lines.forEach((line, i) => {
    if (NAME_BRACE_SPACE.test(line) || SINGLE_NAME_SPACE.test(line)) {
      console.error(`✗ ${name}:${i + 1}  option name contains whitespace\n    ${line.trim()}`);
      bad++;
    }
  });
}

if (bad) {
  console.error(`\n✗ ${bad} malformed spec(s) — an option name must be a single token (see generator/parsers/shared.ts makeFlag).`);
  process.exit(1);
}
console.log(`✓ dist specs clean (${files.length} files)`);
