# tab-please → fzf-tab: render a subcommand's --help in the preview pane.
#
# The right-hand preview pane is empty for subcommand menus because fzf-tab only
# previews things it has a rule for (files, dirs, git refs…). This wires a rule
# for the tools tab-please ships: while you scroll the menu, the highlighted
# subcommand's own `--help` renders on the right.
#
# Scoped to exactly tab-please's tools (derived from dist/), so it never touches
# your other fzf-tab previews. Inert if you don't use fzf-tab — a `:fzf-tab:*`
# zstyle is just config nobody reads without the plugin. Source it from .zshrc
# or let the tab-please plugin source it for you.
#
# fzf-tab's preview shell exposes (see its ftb_preview_init): $words (the full
# command-line array), $word (highlighted candidate), $group (the menu group's
# description), $desc (candidate's description line), $realpath (files only).

# Capture this file's location before entering a function, where $0 changes.
typeset -g _TAB_PLEASE_FT_DIR=${0:A:h}

() {
  emulate -L zsh
  local dist=${_TAB_PLEASE_FT_DIR:h}/dist
  local -a tools=( ${${(f)"$(print -rl -- ${dist}/_*(N:t))"}#_} )
  (( $#tools )) || return 0

  # More specific than the user's ':fzf-tab:complete:*:*' default, so this wins
  # for our tools and nothing else changes.
  zstyle ":fzf-tab:complete:(${(j:|:)tools}):*" fzf-preview '
    if [[ ${group:l} == *command* && -n $word ]]; then
      # Candidate is a subcommand: reconstruct the path typed so far (drop the
      # partial word and any flags) and show that subcommand`s own --help.
      local -a _p=( ${words[2,-2]} ); _p=( ${_p:#-*} )
      ${words[1]} ${_p} ${word} --help 2>&1 | head -300
    elif [[ -n $desc ]]; then
      print -r -- ${desc}
    fi
  '
}

unset _TAB_PLEASE_FT_DIR
