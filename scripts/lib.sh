# Shared helpers, sourced by the other scripts.
#
# After sourcing, the working directory is the repo root and PKGS holds the
# packages to act on: the script's arguments, or every directory with a PKGBUILD.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

# Every package directory in the repo.
all_packages() {
  local f
  for f in */PKGBUILD; do
    [[ -e "$f" ]] && echo "${f%/PKGBUILD}"
  done
}

# Fill PKGS from the arguments (or all packages) and validate them.
# Sets ALL_PACKAGES=true when no packages were named.
select_packages() {
  local p
  ALL_PACKAGES=false
  if (($#)); then
    PKGS=("$@")
  else
    mapfile -t PKGS < <(all_packages)
    ALL_PACKAGES=true
  fi
  for p in "${PKGS[@]}"; do
    [[ -f "$p/PKGBUILD" ]] || die "not a package: $p (no $p/PKGBUILD)"
  done
}

# Ask before running <action> on every package, unless packages were named
# or YES=1 is set. Refuses when there's no terminal to ask on.
confirm_all() {
  local answer
  $ALL_PACKAGES || return 0
  [[ "${YES:-}" == 1 ]] && return 0
  [[ -t 0 ]] || die "refusing to $1 all packages without confirmation; set YES=1 or name packages"
  echo "This will $1 all ${#PKGS[@]} packages:"
  printf '  %s\n' "${PKGS[@]}"
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" == [yY]* ]] || die "cancelled"
}

die() {
  echo "error: $*" >&2
  exit 1
}

# Fail with an install hint when a command is missing: need <cmd> <package>
need() {
  command -v "$1" >/dev/null || die "$1 not found; install $2 with paru (or run: make depsinstall)"
}

# Run a command in each selected package directory.
each() {
  local p
  for p in "${PKGS[@]}"; do
    echo "==> $p"
    (cd "$p" && "$@")
  done
}

# Print the shell files to lint/format: each selected package's PKGBUILD,
# *.sh and *.install files, plus the repo's own scripts.
shell_files() {
  local p f
  for p in "${PKGS[@]}"; do
    echo "$p/PKGBUILD"
    for f in "$p"/*.sh "$p"/*.install; do
      [[ -e "$f" ]] && echo "$f"
    done
  done
  printf '%s\n' scripts/*.sh
}

# Print the paru binary to use, or nothing if paru isn't available.
# PARU overrides the lookup; PARU= (empty) disables paru.
find_paru() {
  if [[ -v PARU ]]; then
    echo "$PARU"
  else
    command -v paru || true
  fi
}

# Install packages, preferring paru (repo + AUR) over pacman (repo only).
install_packages() {
  local paru
  paru=$(find_paru)
  local -a cmd=(sudo pacman)
  [[ -n "$paru" ]] && cmd=("$paru")
  echo "==> ${cmd[*]} -S --needed $*"
  "${cmd[@]}" -S --needed "$@" || {
    # Usually a 404 from a sync database older than the mirrors
    echo >&2
    echo "Install failed. If files couldn't be downloaded (404), the package" >&2
    echo "database is out of date: run '${cmd[*]} -Syu' and try again." >&2
    return 1
  }
}

# Print a package directory's full version ([epoch:]pkgver-pkgrel) from .SRCINFO.
srcinfo_version() {
  awk -F ' = ' '
    /^\tepoch = / { epoch = $2 ":" }
    /^\tpkgver = / { ver = $2 }
    /^\tpkgrel = / { rel = $2 }
    END { if (ver) print epoch ver "-" rel }
  ' "$1/.SRCINFO" 2>/dev/null
}

# Print the local files (not URLs) in a directory's source arrays. Their
# checksums are pinned in the PKGBUILD, so they must not be edited in place.
srcinfo_local_sources() {
  awk -F ' = ' '/^\tsource(_[a-z0-9_]+)? = / && $2 !~ /:\/\// {
    sub(/^.*::/, "", $2)
    print $2
  }' "$1/.SRCINFO" 2>/dev/null
}

# Print the package names a directory builds (more than one for split packages).
srcinfo_pkgnames() {
  awk -F ' = ' '/^pkgname = / { print $2 }' "$1/.SRCINFO" 2>/dev/null
}

# Print the installed version of a package, or nothing if it isn't installed.
installed_version() {
  local pm
  pm=$(find_paru)
  "${pm:-pacman}" -Q "$1" 2>/dev/null | awk '{ print $2 }'
}
