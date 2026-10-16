#!/usr/bin/env bash
# Format PKGBUILDs and shell scripts with shfmt (settings from .editorconfig).
# Local source files (listed in source=()) are left alone, since their
# checksums are pinned in the PKGBUILD.
#
# Usage: scripts/fmt.sh [--check] [package...]
#   --check  show differences without changing files

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

mode=-w
if [[ "${1:-}" == "--check" ]]; then
  mode=-d
  shift
fi
select_packages "$@"
[[ "$mode" == -d ]] || confirm_all "reformat"
need shfmt shfmt

# Skip files listed in source=(): reformatting them breaks their checksums
mapfile -t files < <(shell_files)
declare -A pinned=()
for p in "${PKGS[@]}"; do
  while read -r f; do
    pinned["$p/$f"]=1
  done < <(srcinfo_local_sources "$p")
done
for i in "${!files[@]}"; do
  [[ -n "${pinned[${files[$i]}]:-}" ]] && unset 'files[i]'
done

shfmt "$mode" "${files[@]}"
