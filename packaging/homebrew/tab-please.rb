# Homebrew formula for tab-please.
#
# CANONICAL COPY lives in the tap repo: kumamaki/homebrew-tap (Formula/).
# This copy is the source of truth in-repo; the release workflow bumps `url`/
# `sha256` per tag and syncs it into the tap. Users install with:
#   brew tap kumamaki/tap && brew install tab-please
class TabPlease < Formula
  desc "Generated + enriched zsh completions for popular CLIs"
  homepage "https://github.com/kumamaki/tab-please"
  url "https://github.com/kumamaki/tab-please/archive/refs/tags/v0.3.0.tar.gz"
  sha256 "2d84227aba673571804369ea0d1cb802587a02ae7af2e2d8e9a4a0f382bff015"
  license "WTFPL"

  def install
    zsh_completion.install Dir["dist/_*"]
  end

  test do
    assert_path_exists zsh_completion/"_claude"
  end
end
