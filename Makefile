# Common operations for the packages in this repo. The work is done by the
# scripts in scripts/; run them directly for more options.
#
# Targets act on every package unless PKG is set:
#   make build PKG=raw-thumbnailer
#   make srcinfo PKG="godot-launcher-bin raw-thumbnailer"
#
# Without PKG, targets that change things ask for confirmation first; set
# YES=1 to skip it (needed when there's no terminal).
#
# paru is preferred over makepkg/pacman when installed; set PARU= to disable it.

.DEFAULT_GOAL := help
.PHONY: help list build install chroot sums srcinfo package-list update \
	check check-srcinfo check-package-list verify lint fmt fmt-check \
	clean distclean depscheck depsinstall

S := scripts

# Pass PARU through only when set, so an empty PARU= still means "no paru"
ifneq ($(origin PARU),undefined)
export PARU
endif

# YES=1 skips the confirmation before acting on all packages
export YES

help: ## Show this help
	@echo "Usage: make <target> [PKG=<package>...]"
	@awk -F ':.*## ' '/^##@ / { printf "\n%s\n", substr($$0, 5) } \
		/^[a-z-]+:.*## / { printf "  %-20s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

list: ## List packages and their versions
	@$(S)/list.sh $(PKG)

##@ Packaging

build: ## Build packages (paru -B, or makepkg -f)
	@$(S)/build.sh $(PKG)

install: ## Build and install packages not already up to date (FORCE=1 to reinstall)
	@$(S)/build.sh --install $(if $(FORCE),--force) $(PKG)

chroot: ## Build packages in a clean chroot (devtools)
	@$(S)/chroot.sh $(PKG)

sums: ## Update checksums in PKGBUILDs (updpkgsums)
	@$(S)/sums.sh $(PKG)

srcinfo: ## Regenerate .SRCINFO from PKGBUILD
	@$(S)/srcinfo.sh $(PKG)

package-list: ## Regenerate PACKAGES.md
	@$(S)/gen-package-list.sh

update: ## Checksums, then .SRCINFO, then PACKAGES.md
	@$(S)/update.sh $(PKG)

##@ Checks

check: ## Run all consistency checks
	@$(S)/srcinfo.sh --check $(PKG)
	@$(S)/gen-package-list.sh --check

check-srcinfo: ## Check .SRCINFO matches PKGBUILD
	@$(S)/srcinfo.sh --check $(PKG)

check-package-list: ## Check PACKAGES.md is up to date
	@$(S)/gen-package-list.sh --check

verify: ## Verify source checksums and signatures (downloads missing sources)
	@$(S)/verify.sh $(PKG)

lint: ## Lint PKGBUILDs and scripts (shellcheck, namcap)
	@$(S)/lint.sh $(PKG)

fmt: ## Format PKGBUILDs and scripts (shfmt)
	@$(S)/fmt.sh $(PKG)

fmt-check: ## Show formatting differences without changing files
	@$(S)/fmt.sh --check $(PKG)

##@ Cleanup

clean: ## Remove build directories and built packages
	@$(S)/clean.sh $(PKG)

distclean: ## Also remove downloaded sources (git-ignored files in package dirs)
	@$(S)/clean.sh --dist $(PKG)

##@ Dependencies

depscheck: ## Show which tools are installed
	@$(S)/deps.sh check

depsinstall: ## Install missing tools, choosing which optional ones
	@$(S)/deps.sh install
