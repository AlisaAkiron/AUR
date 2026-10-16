#!/usr/bin/env bash
# Update checksums in PKGBUILDs.
#
# Usage: scripts/sums.sh [package...]

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
select_packages "$@"
confirm_all "update checksums for"
need updpkgsums pacman-contrib
each updpkgsums
