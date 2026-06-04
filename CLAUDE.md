# tab-please

Generated + enriched zsh completions for CLIs, kept fresh from each tool's
`--help`. Public OSS under the **kumamaki** (personal) account; any remote uses
the `personal:` SSH alias, never raw `git@github.com:`.

## Mental model — two layers, merged by path

```
cmd --help (recursive)   ──parse──▶  tools/<cmd>/generated.json   (machine, never hand-edited)
tools/<cmd>/enrich.ts     ───────┐
tools/<cmd>/helpers.zsh   ───────┼──build──▶  dist/_<cmd>          (committed, published)
generator/build.ts        ───────┘
```

`generated.json` is a faithful dump of the command tree + flags + parsed
`(choices:…)`. `enrich.ts` is the durable human layer (value actions, dynamic
lookups). The merge is keyed by command **path**, so enrichment survives
regeneration: a new subcommand from a CLI release shows up automatically (with
boolean flags) and is only upgraded where a human binds an action.

## Golden rules — don't break these

1. **Never hand-edit `dist/_*` or `tools/*/generated.json`.** They're generated.
   Change `tools/<cmd>/enrich.ts` or `helpers.zsh`, then rebuild.
2. **After any change: `bun run build:all && bun run test`.** `test` is
   `validate` (zsh -n + smoke test) **plus** the parser fixtures. CI fails if
   `dist/` is stale relative to sources, a completion fails validation, or an
   adapter stops parsing a committed real-world `--help` snapshot.
3. **Every completion ends with the loader-safe guarded footer** (the build
   emits it). Never a bare `_cmd "$@"` — that runs `_arguments` at source time
   under `.zshrc` loaders that `source` completion files before `compinit`, and
   errors at shell startup. The footer is:
   `if [[ $funcstack[1] = _cmd ]]; then _cmd "$@"; elif (( $+functions[compdef] )); then compdef _cmd cmd; fi`.
4. **Keep the generator dependency-free.** Bun runs the TS directly; don't add
   runtime deps. Prefer a fix in `generator/build.ts` over a per-tool hack — if
   two tools need the same thing, it belongs in the generator.

## Commands

```
bun run parse <cmd>      # cmd --help (recursive) → JSON model (stdout, or --out)
bun run build <cmd>      # generated.json + enrich.ts + helpers.zsh → dist/_<cmd>
                         #   build also takes --from <model.json> to build an
                         #   arbitrary tool outside tools/ (used by on-demand)
bun run regen <cmd>      # parse then build (needs the CLI installed)
bun run build:all        # rebuild every tool that has a generated.json
bun run validate         # zsh -n + deterministic smoke test on every dist/_*
bun run test:fixtures    # detect + parse the tests/fixtures/* --help snapshots
bun run test             # validate + test:fixtures
```

**Two products from one engine:** the *curated collection* (`dist/_*`, enriched,
CI-fresh) and *on-demand* — the plugin's `tab-please add <tool>` function parses
any installed CLI's `--help` into `$TAB_PLEASE_USER_DIR` (default
`~/.local/share/tab-please/completions`) and loads it live. On-demand has no
enrichment layer (no `enrich.ts`/helpers) — structure + flags + printed choices
only. Same generator, lower fidelity.

`tab-please scan [--add]` audits installed tools (`brew leaves` + `~/.cargo/bin`
+ `pipx`) against the live `$_comps` map; the shell side finds commands with no
completion and `generator/scan.ts` classifies each (add / ships-its-own / low
value). The `$_comps` read must stay shell-side — bun can't see it.

`tab-please request <tool>` files a "please curate this" GitHub issue (repo =
`$TAB_PLEASE_REPO` || `kumamaki/tab-please`), via `gh` if authed else a pre-filled
issue URL. It refuses curated/self-generating/flat tools (`--force` overrides;
`--dry-run` files nothing). The verdict logic lives in `generator/classify.ts`
(`classify` / `selfGenerates` / `runHelp` / `toolVersion`), shared by both `scan`
and `request` — don't duplicate it back into either.

## Layout

```
generator/         parse.ts (detect+recurse) · build.ts (emitter) · regen.ts · scan.ts · request.ts · classify.ts · types.ts
generator/parsers/ commander · yargs · cobra · clap · click · argparse · generic · shared.ts
tools/<cmd>/       generated.json · enrich.ts · helpers.zsh
dist/              _<cmd>                  published artifacts (committed)
integrations/      fzf-tab-preview.zsh     subcommand --help in the fzf-tab pane
scripts/     smoke-test.zsh · validate.zsh
tests/             fixtures/<tool>/*.txt (committed real --help) · parser-fixtures.ts
packaging/homebrew/tab-please.rb          canonical copy lives in kumamaki/homebrew-tap
.github/workflows/  ci.yml (PR) · regen.yml (cron + dispatch → opens PR on drift)
```

## enrich.ts keys

`"<path>::<selector>": "<zsh action>"` where:
- path is space-joined subcommands; the **root command is `""`** (empty).
- selector is a flag spelling (`--model`, `-t`) or `pos:N` for the Nth positional.

Action resolution in `build.ts` (first wins): enrich override → parsed
`(choices:…)` → arg-name heuristic (`*dir*`→`_directories`, `*file*`/`*path*`→
`_files`) → boolean (no arg) / plain valued. So don't enrich things `--help`
already expresses; enrich is for dynamic lookups, value sets help omits, and
file/dir typing the heuristic misses.

`enrich.format` pins the parser format (e.g. `"generic"`). `regen.ts` reads it
and passes `--format`, so a tool that doesn't auto-detect keeps its format
across regenerations instead of being re-detected away. The root command is the
binary name; subcommand nodes inherit the format (one adapter per tree).

## Dynamic helpers (helpers.zsh)

Functions that shell out to the CLI for runtime state (servers, plugins). Cache
yourself with a glob-qualifier TTL — do **not** rely on the user's `use-cache`
zstyle: `local -a stale=( $cache(Nmm+60) )` rebuilds if older than 60 min.

## Parser adapters

`parse.ts` is a driver: it auto-detects the help format and dispatches to an
adapter in `generator/parsers/<name>.ts`. Supported: commander, yargs, cobra,
clap, click, argparse, plus a `generic` getopt fallback (opt-in only).

- **Add a format** = one file default-exporting an `Adapter` (`detect` +
  `parsePage`). Nothing else changes; `parse.ts` finds it via `--format <name>`
  and the `DETECT_ORDER` list. Mirror `parsers/commander.ts`; reuse
  `parsers/shared.ts`.
- **Detection must be specific** — order is most-specific-first in
  `DETECT_ORDER`; `generic` is never auto-detected (it would swallow everything).
- **Prove it with a fixture, not a shipped completion.** To claim a format
  works, capture a real CLI's `--help` into `tests/fixtures/<tool>/` and add an
  entry to `tests/parser-fixtures.ts` (it reuses the real `detectAdapter`). This
  is how the `kubectl`/`docker`/`cargo`/`pipx` claims stay honest *without*
  shipping static completions that would shadow those tools' own dynamic ones.
- **The driver is resilient**: a subcommand whose `--help` fails degrades to a
  leaf (it does not abort the parse); `runHelp` reads stdout *and* stderr.
- **Known tech debt:** several adapters (yargs/cobra/clap) carry local
  entry-grouping helpers because `shared.groupEntries`/`sectionize` assume
  colon-terminated headers and deeper-indented wrap lines, which column-aligned
  and loose-header formats violate. Consolidate a `groupEntries(lines, {isHead,
  keepBlanks})` + a looser `sectionize` into `shared.ts` and delete the dupes —
  but re-validate every tool after (it touches all adapters).

## Conventions & gotchas

- **`fnName` keeps hyphens** (`_sea-orm-cli`, not `_sea_orm_cli`). The root
  function must match the `#compdef <cmd>` tag, the filename, and the footer, or
  a hyphenated command (`sea-orm-cli`, `tokio-console`) autoloads a name that
  isn't defined → dead completion. Don't re-mangle them to `_`.
- The parser rejects non-command lines at the Commands indent (e.g. an embedded
  `Examples:` block) via `isCommandToken` (lowercase-identifier check) — keep it.
- **Testing:** prefer the deterministic stub smoke test (`scripts/smoke-test.zsh`)
  over pty-driven Tab tests, which race zsh's cold start. When testing by hand,
  never `source` a completion inside `$(...)` — command substitution is a
  subshell and the function defs vanish.
- **Shell loops:** don't end a loop body with `[ -f x ] && cmd` — a false test
  becomes the loop's exit code and fails the script. Use `if … then … fi`.
- Descriptions: the build strips `(choices:…)`/`(default:…)`/`(preset:…)` noise;
  keep the remaining text meaningful — it shows in the completion menu.

## Adding a tool

See `CONTRIBUTING.md`. Short version: `parse` it, eyeball `generated.json`, add
`tools/<tool>/enrich.ts`, build, validate, and add its install step to
`.github/workflows/regen.yml`.
