# skills-manager-appimage-bin

Written by me. Repackages the prebuilt Tauri desktop app from the `.AppImage`
in the [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager)
GitHub releases.

Not based on the existing AUR `skills-manager-bin` or `skills-manager`
packages.

## Packaging notes

- **The AppImage is installed as-is** to
  `/opt/skills-manager/skills-manager.AppImage`. It bundles its own GTK and
  WebKitGTK, but not the libraries on linuxdeploy's excludelist (glibc,
  libGL/EGL, Mesa's libgbm, libdrm, fontconfig, freetype, harfbuzz, libX11,
  ...), so those are in `depends`. AppRun is a bash script.
- **FUSE.** Upstream uses the static type2 runtime, which mounts with any
  `fusermount` on `PATH`; both fuse2's `fusermount` and fuse3's `fusermount3`
  work. `depends` names `fuse3`.
- **Bundled CLI.** The AppImage also contains `skills-manager-cli`: the
  standalone release binary with a `RUNPATH` of `$ORIGIN/../lib` added by
  linuxdeploy. On startup the app copies it from next to its own executable
  to `~/.skills-manager/bin/` (skipped when `~/.skills-manager/bin/.version`
  already matches). The CLI is not installed to `/usr/bin`; use
  [skills-manager-cli-bin](../skills-manager-cli-bin/) for that.
- **Forced X11.** The bundled linuxdeploy GTK hook exports `GDK_BACKEND=x11`
  and `GTK_THEME=Adwaita:<light|dark>` (override the theme with
  `APPIMAGE_GTK_THEME`), so on Wayland the app runs under XWayland.
- **Desktop entry and icons** are pulled out of the AppImage in `prepare()`
  with `--appimage-extract`, which runs the downloaded AppImage, so the
  package can only be built on the target architecture (or with qemu-user
  binfmt).
- **No launcher wrapper.** `/usr/bin/skills-manager` is a symlink to the
  AppImage. The `.deb` package needed a wrapper setting
  `__NV_DISABLE_EXPLICIT_SYNC=1` because WebKitGTK exits on Wayland with
  NVIDIA drivers (`Error 71 (Protocol error) dispatching to Wayland display`);
  this AppImage forces X11 (see above), so that error doesn't apply.
- **Desktop entry fixed.** Upstream ships `Name=skills-manager` and an empty
  `Categories=`; `prepare()` sets `Name=Skills Manager` and
  `Categories=Development;Utility;`.
