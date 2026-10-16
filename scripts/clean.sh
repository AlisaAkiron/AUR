#!/usr/bin/env bash
# Remove build output from package directories.
#
# Usage: scripts/clean.sh [--dist] [package...]
#   --dist  also remove downloaded sources (every git-ignored file)

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

dist=false
if [[ "${1:-}" == "--dist" ]]; then
  dist=true
  shift
fi
select_packages "$@"
if $dist; then
  confirm_all "delete build output and downloaded sources of"
else
  confirm_all "delete build output of"
fi

if $dist; then
  # -X only removes ignored files, so new untracked files are kept
  git clean -dfX -- "${PKGS[@]}"
else
  each bash -c 'shopt -s nullglob; rm -rf src pkg *.pkg.tar *.pkg.tar.* *.src.tar.gz *.log'
fi
