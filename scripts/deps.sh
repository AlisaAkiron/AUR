#!/usr/bin/env bash
# Check for, or install, the tools this repo's scripts use.
#
# Usage: scripts/deps.sh check
#        scripts/deps.sh install [package...]
#
# `install` installs any missing required tools, then asks which optional
# ones to install. Pass package names to choose them without the prompt,
# or `all` for every optional tool. Installs with paru when available
# (PARU= disables it), otherwise pacman.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# command|package|required or optional|what needs it
DEPS=(
  "bash|bash|required|everything"
  "make|make|required|the Makefile"
  "makepkg|pacman|required|build, srcinfo, check"
  "rm|coreutils|required|clean, scripts"
  "awk|gawk|required|package list, make list, make help"
  "grep|grep|required|package list"
  "column|util-linux|required|make list"
  "diff|diffutils|required|check"
  "git|git|required|distclean"
  "paru|paru|optional|build, install, depsinstall (falls back to makepkg/pacman)"
  "updpkgsums|pacman-contrib|optional|sums, update"
  "extra-x86_64-build|devtools|optional|chroot"
  "shellcheck|shellcheck|optional|lint"
  "namcap|namcap|optional|lint"
  "shfmt|shfmt|optional|fmt, fmt-check"
)

# Packages only in the AUR, which pacman can't install (paru can).
AUR_ONLY=(paru)

is_aur_only() {
  local a
  for a in "${AUR_ONLY[@]}"; do
    [[ "$a" == "$1" ]] && return 0
  done
  return 1
}

# Print "package|kind|used-by" for each dependency whose command is missing.
missing() {
  local dep cmd pkg kind used
  for dep in "${DEPS[@]}"; do
    IFS='|' read -r cmd pkg kind used <<<"$dep"
    command -v "$cmd" >/dev/null || echo "$pkg|$kind|$used"
  done
}

cmd_check() {
  local dep cmd pkg kind used status failed=0
  printf '%-20s %-16s %-9s %-8s %s\n' COMMAND PACKAGE KIND STATUS "USED BY"
  for dep in "${DEPS[@]}"; do
    IFS='|' read -r cmd pkg kind used <<<"$dep"
    if command -v "$cmd" >/dev/null; then
      status=ok
    else
      status=missing
      [[ "$kind" == required ]] && failed=1
    fi
    printf '%-20s %-16s %-9s %-8s %s\n' "$cmd" "$pkg" "$kind" "$status" "$used"
  done
  if ((failed)); then
    echo >&2
    echo "Required tools are missing; run: make depsinstall" >&2
  fi
  return "$failed"
}

# Ask which of the given optional packages to install; sets CHOSEN.
# Runs in the current shell (not a subshell) so an invalid choice exits.
choose() {
  local -a opts=("$@")
  local i answer n pkg used
  echo "Optional tools not installed:"
  for i in "${!opts[@]}"; do
    IFS='|' read -r pkg _ used <<<"${opts[$i]}"
    printf '  %d) %-16s %s\n' $((i + 1)) "$pkg" "$used"
  done
  read -r -p 'Install which? (numbers separated by spaces, a = all, empty = none): ' answer
  [[ "$answer" == a ]] && answer=$(seq 1 "${#opts[@]}")
  CHOSEN=()
  for n in $answer; do
    [[ "$n" =~ ^[0-9]+$ ]] && ((n >= 1 && n <= ${#opts[@]})) || die "invalid choice: $n"
    CHOSEN+=("${opts[$((n - 1))]%%|*}")
  done
}

cmd_install() {
  local pkg kind used
  local -a required=() optional=() chosen=() install=() aur=()

  while IFS='|' read -r pkg kind used; do
    if [[ "$kind" == required ]]; then
      required+=("$pkg")
    else
      optional+=("$pkg|$kind|$used")
    fi
  done < <(missing)

  if (($#)); then
    if [[ "$1" == all ]]; then
      chosen=("${optional[@]%%|*}")
    else
      chosen=("$@")
    fi
  elif ((${#optional[@]})); then
    choose "${optional[@]}"
    chosen=("${CHOSEN[@]}")
  fi

  local paru
  paru=$(find_paru)
  for pkg in "${required[@]}" "${chosen[@]}"; do
    if [[ -z "$paru" ]] && is_aur_only "$pkg"; then
      # Already installed AUR tools are skipped, like --needed does for the rest
      command -v "$pkg" >/dev/null || aur+=("$pkg")
    else
      install+=("$pkg")
    fi
  done

  if ((${#install[@]} == 0 && ${#aur[@]} == 0)); then
    echo "Nothing to install."
    return
  fi

  ((${#install[@]})) && install_packages "${install[@]}"

  for pkg in "${aur[@]}"; do
    # Without paru, installing from the AUR means running someone else's
    # PKGBUILD by hand, so leave that to the user.
    cat <<MSG

$pkg is only in the AUR and paru isn't available. To install it yourself:
  git clone https://aur.archlinux.org/$pkg-bin.git
  cd $pkg-bin && makepkg -si
MSG
  done
}

case "${1:-}" in
  check) cmd_check ;;
  install) shift && cmd_install "$@" ;;
  *) die "usage: $0 check | install [package... | all]" ;;
esac
