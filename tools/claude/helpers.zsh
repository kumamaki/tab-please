# Dynamic completion helpers for claude — injected verbatim at the top of
# dist/_claude by the build. These are the bits that stay correct as your
# environment changes (installed plugins, configured MCP servers), independent
# of the snapshotted command tree.

(( $+functions[_claude_models] )) || _claude_models() {
  local -a models=(
    'opus:Latest Opus alias'
    'sonnet:Latest Sonnet alias'
    'haiku:Latest Haiku alias'
  )
  _describe -t models 'model' models
}

(( $+functions[_claude_setting_sources] )) || _claude_setting_sources() {
  _values -s , 'setting source' user project local
}

# Configured MCP servers. Cached 60 min — `claude mcp list` runs a network
# health-check that is too slow to invoke on every Tab.
(( $+functions[_claude_mcp_servers] )) || _claude_mcp_servers() {
  local -a servers
  local cache="${TMPDIR:-/tmp}/.claude_mcp_servers.$UID"
  local -a stale=( $cache(Nmm+60) )
  if [[ ! -s $cache || ${#stale} -gt 0 ]]; then
    claude mcp list 2>/dev/null | sed -n 's/^\(.*\): .* - .*/\1/p' >| $cache 2>/dev/null
  fi
  servers=( ${(f)"$(<$cache 2>/dev/null)"} )
  (( $#servers )) && _describe -t mcp-servers 'MCP server' servers
}

# Installed plugins (name@marketplace). Cached 1 min so enable/disable state
# stays fresh without re-shelling on every Tab.
(( $+functions[_claude_plugins] )) || _claude_plugins() {
  local -a plugins
  local cache="${TMPDIR:-/tmp}/.claude_plugins.$UID"
  local -a stale=( $cache(Nmm+1) )
  if [[ ! -s $cache || ${#stale} -gt 0 ]]; then
    claude plugin list 2>/dev/null | awk '/❯/{print $2}' >| $cache 2>/dev/null
  fi
  plugins=( ${(f)"$(<$cache 2>/dev/null)"} )
  (( $#plugins )) && _describe -t plugins 'plugin' plugins
}
