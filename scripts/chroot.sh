#!/usr/bin/env bash
# Build packages in a clean chroot with devtools.
#
# Usage: scripts/chroot.sh [package...]

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
select_packages "$@"
confirm_all "build (in a clean chroot)"
need extra-x86_64-build devtools
each extra-x86_64-build
