#!/usr/bin/env bash
# List packages with their versions (from .SRCINFO).
#
# Usage: scripts/list.sh [package...]

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
select_packages "$@"

for p in "${PKGS[@]}"; do
  v=$(srcinfo_version "$p")
  printf '%s\t%s\n' "$p" "${v:-?}"
done | column -t -s $'\t'
