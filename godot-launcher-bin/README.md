# godot-launcher-bin

Modified version of the AUR package
[godot-launcher-bin](https://aur.archlinux.org/packages/godot-launcher-bin)
by zxp19821005.

Based on AUR commit
[`c46ec04`](https://aur.archlinux.org/cgit/aur.git/commit/?h=godot-launcher-bin&id=c46ec04084862135b1534b0f4509892e10caac72)
("update to 1.13.0", `1.13.0-1`).

## Changes from the AUR version

- **Removed the platform-file cleanup step from `prepare()`.** The original
  deletes every directory and file in `$srcdir` whose name contains
  `darwin`, `ia32`, `android`, `win32`, or the "other" architecture (`arm` on
  x86_64, `x64` on aarch64). Those substring patterns are broad and can remove
  files the app needs, so this version leaves the extracted app untouched.

  Removed lines:

  ```sh
  local _archrem=$([[ "${CARCH}" == "aarch64" ]] && echo x64 || echo arm)
  find "${srcdir}" -type d \
      \( -name '*darwin*' -o -name "*ia32*" -o -name '*android*' -o -name '*win32*' -o -name "*${_archrem}*" \) \
      -prune -exec rm -rf {} +
  find "${srcdir}" -type f \
      \( -name '*darwin*.*' -o -name "*ia32*.*" -o -name '*android*.*' -o -name '*win32*.*' -o -name "*${_archrem}*.*" \) \
      -delete
  ```

- `pkgrel` bumped `1` → `2` for the packaging change.
- `.SRCINFO` regenerated.

`godot-launcher.sh` is unchanged from the AUR version.
