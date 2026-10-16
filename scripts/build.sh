#!/usr/bin/env bash
# Build packages, using paru when it's installed and makepkg otherwise.
#
# Usage: scripts/build.sh [--install [--force]] [package...]
#   --install  also install the built packages, skipping ones already
#              installed at the same version
#   --force    with --install, reinstall packages even if up to date
#
# Set PARU to choose the paru binary, or PARU= (empty) to force makepkg.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install=false
force=false
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --install) install=true ;;
    --force) force=true ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
select_packages "$@"
if $install && $force; then
  confirm_all "rebuild and reinstall"
elif $install; then
  confirm_all "build and install"
else
  confirm_all "build"
fi

# True when every package built from directory $1 is installed at the
# version in its .SRCINFO.
up_to_date() {
  local want name have
  want=$(srcinfo_version "$1")
  [[ -n "$want" ]] || return 1
  while read -r name; do
    have=$(installed_version "$name")
    if [[ "$have" != "$want" ]]; then
      echo "==> $1: ${name} ${have:-not installed} -> $want"
      return 1
    fi
  done < <(srcinfo_pkgnames "$1")
  echo "==> $1: $want already installed, skipping"
}

if $install && ! $force; then
  todo=()
  for p in "${PKGS[@]}"; do
    up_to_date "$p" || todo+=("$p")
  done
  if ((${#todo[@]} == 0)); then
    echo "Everything is up to date (use FORCE=1 to reinstall)."
    exit 0
  fi
  PKGS=("${todo[@]}")
fi

paru=$(find_paru)

if [[ -n "$paru" ]]; then
  # paru resolves AUR dependencies and builds all targets in one go
  flags=(-B --rebuild)
  $install && flags=(-Bi --rebuild)
  set -x
  "$paru" "${flags[@]}" "${PKGS[@]}"
elif $install; then
  each makepkg -sif
else
  each makepkg -f
fi
