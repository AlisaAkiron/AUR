#!/usr/bin/env bash
# Verify source checksums (and PGP signatures) against the PKGBUILD.
# Downloads any sources that aren't already in the package directory.
#
# Usage: scripts/verify.sh [package...]

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
select_packages "$@"
confirm_all "download and verify sources for"
# -f: otherwise makepkg refuses to run when a built package already exists
each makepkg --verifysource -f
