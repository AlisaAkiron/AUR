#!/usr/bin/env bash
# Lint PKGBUILDs and shell scripts with shellcheck and namcap.
#
# Usage: scripts/lint.sh [package...]

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
select_packages "$@"
need shellcheck shellcheck
need namcap namcap

mapfile -t files < <(shell_files)

echo "==> shellcheck"
shellcheck -x "${files[@]}"
each namcap PKGBUILD
