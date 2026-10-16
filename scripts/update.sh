#!/usr/bin/env bash
# After editing PKGBUILDs: update checksums, then .SRCINFO, then PACKAGES.md.
#
# Usage: scripts/update.sh [package...]

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
select_packages "$@"
confirm_all "update checksums and .SRCINFO for"

# Named packages, so the steps below don't ask again
"$ROOT/scripts/sums.sh" "${PKGS[@]}"
"$ROOT/scripts/srcinfo.sh" "${PKGS[@]}"
"$ROOT/scripts/gen-package-list.sh"
