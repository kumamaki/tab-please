# tab-please — zsh completion plugin entrypoint.
# Works with zap, zinit, antidote, oh-my-zsh, or a bare `source` from .zshrc.
#
# APPENDS dist/ to fpath (never prepends), so a tool's own completion — gh's,
# docker's, anything dynamic you've set up — keeps winning. tab-please only
# fills the gaps: tools with no decent completion (claude, wrangler).

0=${(%):-%N}
typeset -g _TAB_PLEASE_DIR=${0:A:h}

# Curated completions ship in dist/; on-demand ones (`tab-please add`) land in a
# writable user dir. Both APPEND to fpath so a tool's own completion still wins.
# Keep fpath unique so re-sourcing or repeated `tab-please add` can't grow it
# with duplicate entries.
typeset -gU fpath
typeset -g _TAB_PLEASE_USER_DIR=${TAB_PLEASE_USER_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/tab-please/completions}
# completions/ holds the plugin's own hand-written completion (_tab-please) — it
# lives here, not dist/, because it completes the plugin-only `tab-please`
# function, which Homebrew-only users don't have.
fpath=($fpath "${_TAB_PLEASE_DIR}/dist" "${_TAB_PLEASE_DIR}/completions" "${_TAB_PLEASE_USER_DIR}")

# Mark each completion for autoload — but skip any name something else already
# provides (e.g. `source <(gh completion -s zsh)`), so we never replace a richer
# completion.
#
# Init order matters here:
#   · compinit hasn't run yet (omz, most managers): just autoload. compinit will
#     scan our just-appended fpath dirs and register the `#compdef` tags itself.
#   · compinit already ran (sourced late; some managers compinit first): its dump
#     is frozen — `compinit -C` would NOT rescan our new dirs, so the tags never
#     fire this session. So we bind each completion ourselves with `compdef`, but
#     only when nothing already completes that command, so a tool's own (richer)
#     completion still wins. `compdef` exists only once compinit has run, which is
#     exactly the case where we need it — so its presence is the branch condition.
#
# Relies on the repo invariant (CLAUDE.md): filename `_cmd` ↔ command `cmd` ↔
# `#compdef cmd`, so `${f#_}` is the command name.
() {
  local f cmd
  for f in "${_TAB_PLEASE_DIR}/dist"/_*(N:t) "${_TAB_PLEASE_DIR}/completions"/_*(N:t) "${_TAB_PLEASE_USER_DIR}"/_*(N:t); do
    (( $+functions[$f] )) && continue
    autoload -Uz -- "$f"
    cmd=${f#_}
    if (( $+functions[compdef] )) && [[ -z ${_comps[$cmd]} ]]; then
      compdef "$f" "$cmd"
    fi
  done
}

# `tab-please` — manage on-demand completions. On-demand ones are lower fidelity
# than the curated tools (structure + flags + printed choices, but no enrichment:
# no live/dynamic values, no value sets --help omits). Needs bun.
#   add <tool> [--format <name>]   generate a completion for an installed CLI and
#                                  load it into this shell now
#   scan [--add]                   list installed tools with no completion and say
#                                  what to do (add · enable native · skip); --add
#                                  generates the worth-adding ones
tab-please() {
  emulate -L zsh
  setopt local_options null_glob
  local sub=$1; (( $# )) && shift
  case $sub in
    add)
      local tool=$1; (( $# )) && shift
      [[ -n $tool ]] || { print -u2 "usage: tab-please add <tool> [--format <name>]"; return 1 }
      (( $+commands[$tool] )) || { print -u2 "tab-please: '$tool' is not an installed command"; return 1 }
      (( $+commands[bun] ))   || { print -u2 "tab-please: needs 'bun' on PATH"; return 1 }
      command mkdir -p -- "$_TAB_PLEASE_USER_DIR" || return 1
      local model="$_TAB_PLEASE_USER_DIR/.${tool}.json"
      local out="$_TAB_PLEASE_USER_DIR/_${tool}"
      # parse streams a live spinner to stderr (it owns the slow recursion);
      # build prints just the command count to stdout under --quiet, which we
      # capture and fold into one clean success banner. Keeps user-facing output
      # on stdout, off the red diagnostics channel.
      local ncmd
      if bun "$_TAB_PLEASE_DIR/generator/parse.ts" "$tool" "$@" --out "$model" --quiet &&
         ncmd=$(bun "$_TAB_PLEASE_DIR/generator/build.ts" "$tool" --from "$model" --out "$out" --quiet); then
        fpath=($fpath "$_TAB_PLEASE_USER_DIR")
        unfunction "_${tool}" 2>/dev/null
        autoload -Uz "_${tool}"
        (( $+functions[compdef] )) && compdef "_${tool}" "$tool"
        local g d nc
        if [[ -t 1 && -z $NO_COLOR ]]; then g=$'\e[32m' d=$'\e[2m' nc=$'\e[0m'; fi
        print -r -- "${g}✓${nc} ${tool} ready ${d}— ${ncmd} commands, active in this shell${nc}"
        print -r -- "  ${d}${out}${nc}"
      else
        print -u2 "tab-please: failed to generate a completion for '${tool}'"; return 1
      fi
      ;;
    scan)
      (( $+commands[bun] )) || { print -u2 "tab-please: needs 'bun' on PATH"; return 1 }
      # formula/alias name → real command, for the few that differ
      local -A rename=(
        ripgrep rg  cloudflare-wrangler wrangler  git-delta delta  tlrc tldr
        netlify-cli netlify  gemini-cli gemini  protobuf protoc  ghostscript gs
        smartmontools smartctl
      )
      # Intentionally-installed tools only (not every binary in PATH — that's noise).
      local -a names=(
        ${(f)"$(brew leaves 2>/dev/null)"}
        ~/.cargo/bin/*(N.:t)
        ${(f)"$(pipx list --short 2>/dev/null | awk '{print $1}')"}
      )
      local -a cand; local t cmd
      for t in ${(u)names}; do
        # drop cargo subcommand plugins and rust toolchain internals (not CLIs you complete)
        [[ $t == (cargo-*|clippy-driver|rls|rust-analyzer|rust-gdb|rust-gdbgui|rust-lldb|rustc|rustdoc|rustfmt) ]] && continue
        cmd=${rename[$t]:-$t}
        (( $+commands[$cmd] )) || continue                                   # formula with no direct command
        [[ -z ${_comps[$cmd]} || ${_comps[$cmd]} == (_default|_gnu_generic) ]] || continue   # already completes
        cand+=$cmd
      done
      if (( ! $#cand )); then
        print "tab-please: every installed tool already completes ✓"
        return 0
      fi
      print -u2 "tab-please: ${#cand} installed tools have no completion — classifying…"
      local add
      add=$(bun "$_TAB_PLEASE_DIR/generator/scan.ts" ${(u)cand})
      if [[ $1 == --add && -n $add ]]; then
        local c
        for c in ${(f)add}; do tab-please add "$c"; done
      fi
      ;;
    request)
      (( $+commands[bun] )) || { print -u2 "tab-please: needs 'bun' on PATH"; return 1 }
      bun "$_TAB_PLEASE_DIR/generator/request.ts" "$@"
      ;;
    *)
      print -u2 "usage: tab-please <command>
  add <tool> [--format <name>]   generate a completion for an installed CLI
  scan [--add]                   find installed tools with no completion
  request <tool> [--force]       ask for a tool to be curated (files a GitHub issue)"
      return 1
      ;;
  esac
}

# Optional fzf-tab integration: show a subcommand's --help in the preview pane.
# Inert if you don't use fzf-tab; scoped to our tools so it won't touch your
# other previews. Disable with `export TAB_PLEASE_FZF_PREVIEW=0`.
if [[ ${TAB_PLEASE_FZF_PREVIEW:-1} != 0 && -r "${_TAB_PLEASE_DIR}/integrations/fzf-tab-preview.zsh" ]]; then
  source "${_TAB_PLEASE_DIR}/integrations/fzf-tab-preview.zsh"
fi
