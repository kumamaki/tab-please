# Contributing

## Add a new tool

Say the binary is `foo`.

1. **Snapshot its help** (you need `foo` installed locally):

   ```zsh
   mkdir -p tools/foo
   bun generator/parse.ts foo --out tools/foo/generated.json
   ```

   The format is auto-detected (commander/yargs/cobra/clap/click/argparse).
   Eyeball `generated.json` — check the `format` field and that the tree/flags
   look right. If detection picked wrong, force it with `--format <name>`. If
   `foo` uses a format we don't parse yet, see "New help formats" below.

2. **Build it** (no enrichment yet — boolean flags, plain positionals):

   ```zsh
   bun generator/build.ts foo
   zsh scripts/smoke-test.zsh dist/_foo foo
   ```

3. **Enrich it.** Create `tools/foo/enrich.ts`:

   ```ts
   import type { Enrich } from "../../generator/types.ts";

   const enrich: Enrich = {
     helpersFile: "helpers.zsh", // optional, for dynamic completions
     actions: {
       // "<command path>::<selector>": "<zsh action>"
       // path is space-joined subcommands; root = "" ; selector is a flag
       // spelling (--model, -t) or pos:N for the Nth positional.
       "::--region": "(us-east-1 eu-west-1)",
       "deploy::--env": "(dev staging prod)",
       "secret get::pos:1": "_foo_secrets", // a helper from helpers.zsh
     },
   };
   export default enrich;
   ```

   What the build resolves **without** enrichment (don't bother adding these):
   - flags with a parsed `(choices: …)` → the value set
   - args named like `*dir*`/`*directory*` → `_directories`; `*file*`/`*path*` → `_files`

   What enrichment is **for**: dynamic lookups (`_foo_secrets`), value sets
   `--help` doesn't print, file/dir typing the heuristic misses, and positional
   completions.

4. **Dynamic helpers** (optional) go in `tools/foo/helpers.zsh` — zsh functions
   that shell out to `foo` and cache. Cache yourself with a glob-qualifier TTL;
   don't rely on the user's `use-cache` zstyle:

   ```zsh
   (( $+functions[_foo_secrets] )) || _foo_secrets() {
     local -a items
     local cache="${TMPDIR:-/tmp}/.foo_secrets.$UID"
     local -a stale=( $cache(Nmm+5) )         # rebuild if >5 min old
     if [[ ! -s $cache || ${#stale} -gt 0 ]]; then
       foo secret list --quiet 2>/dev/null >| $cache 2>/dev/null
     fi
     items=( ${(f)"$(<$cache 2>/dev/null)"} )
     (( $#items )) && _describe -t secrets 'secret' items
   }
   ```

5. **Wire it into regen** — add the install command to the `Install CLIs` step
   in `.github/workflows/regen.yml` so CI keeps it fresh.

6. **Validate and open a PR:**

   ```zsh
   bun run build:all && bun run validate
   ```

## New help formats

Supported today: commander, yargs, cobra, clap, click, argparse (+ a `generic`
getopt fallback). If `foo` uses something else, add an adapter — it's one file:

- Create `generator/parsers/<format>.ts` default-exporting an `Adapter`
  (`detect(rootHelp)` + `parsePage(help) → {flags, subcommands, positionals}`).
  Mirror `parsers/commander.ts`, reuse `parsers/shared.ts`, and add the name to
  `DETECT_ORDER` in `parse.ts` (most-specific-first). Every CLI using that
  format then works for free.
- `detect()` must be specific — test it doesn't fire on the other formats.
- Last resort: skip `generated.json` and hand-author the whole spec in
  `enrich.ts` — the build runs from enrichment alone when there's no
  `generated.json`.

## Quality bar

- `zsh -n` clean and the smoke test passes (CI enforces both).
- Descriptions are meaningful — they show in the menu.
- Prefer structural fixes in the generator over per-tool hacks; if two tools
  need the same thing, it belongs in `build.ts`.
- No `(choices:…)`/`(default:…)` noise in descriptions (the build strips it).
