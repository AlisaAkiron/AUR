# AUR packages

Personal PKGBUILDs, built locally. Not published to the AUR.

> [!WARNING]
> Use at your own risk. Some packages are modified versions of AUR packages
> (changes listed in each package's `README.md`); don't report issues with
> them to the original maintainers.

Package list: [PACKAGES.md](PACKAGES.md) (generated; `make package-list`).

## Usage

Run `make` to see all targets. Common ones:

```sh
make depsinstall                  # install the tools the scripts need
make install PKG=raw-thumbnailer  # build + install, skipped if up to date
make update PKG=raw-thumbnailer   # after editing a PKGBUILD: sums, .SRCINFO, list
make check verify                 # generated files in sync, checksums valid
```

- Without `PKG`, targets apply to all packages and ask first (`YES=1` skips).
- Uses paru when installed; `PARU=` forces makepkg/pacman.

## License

Repo files are [0BSD](LICENSE). Package directories follow the
[AUR guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines):
a package's own `LICENSE` file, if present, applies to it; otherwise packages
I wrote are 0BSD, and packages modified from the AUR (see
[PACKAGES.md](PACKAGES.md)) keep their original authors' terms. Packaged
software keeps its upstream license (see each PKGBUILD's `license=()`).
