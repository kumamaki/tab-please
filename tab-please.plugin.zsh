# tab-please — zsh completion plugin entrypoint.
# Works with zap, zinit, antidote, oh-my-zsh, or a bare `source` from .zshrc.
#
# APPENDS dist/ to fpath (never prepends), so a tool's own completion — gh's,
# docker's, anything dynamic you've set up — keeps winning. tab-please only
# fills the gaps: tools with no decent completion (claude, wrangler).

0=${(%):-%N}
typeset -g _TAB_PLEASE_DIR=${0:A:h}

fpath=($fpath "${_TAB_PLEASE_DIR}/dist")

# Mark each shipped completion for autoload — but skip any name something else
# already provides (e.g. `source <(gh completion -s zsh)`), so we never replace
# a richer completion. Ours self-register via their guarded footer on init.
() {
  local f
  for f in "${_TAB_PLEASE_DIR}/dist"/_*(N:t); do
    (( $+functions[$f] )) && continue
    autoload -Uz -- "$f"
  done
}

# If compinit already ran (some managers init completions before sourcing
# plugins), rescan so our additions take effect this session.
(( $+functions[compinit] )) && compinit -C 2>/dev/null

# Optional fzf-tab integration: show a subcommand's --help in the preview pane.
# Inert if you don't use fzf-tab; scoped to our tools so it won't touch your
# other previews. Disable with `export TAB_PLEASE_FZF_PREVIEW=0`.
if [[ ${TAB_PLEASE_FZF_PREVIEW:-1} != 0 && -r "${_TAB_PLEASE_DIR}/integrations/fzf-tab-preview.zsh" ]]; then
  source "${_TAB_PLEASE_DIR}/integrations/fzf-tab-preview.zsh"
fi
