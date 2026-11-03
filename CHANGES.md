# Project changes

Format version: `changes/v1`

## CHG-001 — Add reversible v1/v2 curl installer

- **scope:** `project` · **status:** `applied` · **kind:** `script` · **date:** 2026-11-03
- **subject:** `feat: add safe curl-capable installer for v1 and v2`
- **how:** Added `install.sh` with v1/v2/both install modes, JSONC-aware v1 TUI registration, remote companion-file retrieval through `OCA_BASE_URL`, dry-run, baseline backup, and uninstall. Documented usage and the missing hosted URL in `README.md`.
- **reverse:** `git revert --no-edit 784d536` reverts the installer and documentation; restore an installed machine with `./install.sh uninstall` first.
- **verify:** `bash -n install.sh` and `shellcheck -x install.sh` exit 0; sandbox smoke test verified dry-run non-mutation, install, idempotent rerun, and uninstall restoration; piped-install test with local `OCA_BASE_URL` passed.
- **side_effects:** A real install writes plugin files to OpenCode config directories and adds a v1 entry to `tui.json`; OpenCode restart is required. Hosted `curl | bash` needs `OCA_BASE_URL`; no Git remote is configured, so a public install URL is not yet available.
- **author:** `agent`
