#!/usr/bin/env bash
# Regenerate .SRCINFO from PKGBUILD, or check it's up to date.
#
# Usage: scripts/srcinfo.sh [--check] [package...]

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

check=false
if [[ "${1:-}" == "--check" ]]; then
  check=true
  shift
fi
select_packages "$@"
$check || confirm_all "regenerate .SRCINFO for"

write_srcinfo() {
  makepkg --printsrcinfo >.SRCINFO
}

check_srcinfo() {
  diff -u .SRCINFO <(makepkg --printsrcinfo) || {
    echo ".SRCINFO is out of date; run: make srcinfo" >&2
    return 1
  }
}

if $check; then
  each check_srcinfo
else
  each write_srcinfo
fi
