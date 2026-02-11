# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [Unreleased]

### Features

- **cli**: add status check (`-s`/`--status`) to check if a named process is running
- **cli**: add kill-all (`-K`/`--kill-all`) to kill all tracked processes at once
- **cli**: add ensure mode (`-e`/`--ensure`) for idempotent process start
- **cli**: add clean (`--clean`) to remove stale PID files
- **cli**: add PID output (`-p`/`--pid`) to print raw PID for scripting
- **cli**: add wait (`-w`/`--wait`) with optional `--timeout` to block until process exits

### Bug Fixes

- **windows**: allow child process to run cleanup handlers on Ctrl+C instead of force-killing immediately ([#graceful-shutdown](https://github.com/radleta/just-one/issues/graceful-shutdown))

Previously, `setupSignalHandlers` called `process.kill(pid, 'SIGINT')` on Windows which invokes `TerminateProcess` — killing the child instantly without running cleanup handlers (e.g., removing temp files, closing connections). Now, `just-one` relies on the OS-delivered `CTRL_C_EVENT` via the shared console and only force-kills after a 2-second grace period if the child hasn't exited.

## [1.1.0](https://github.com/radleta/just-one/compare/v1.0.0...v1.1.0) (2026-01-29)

### Features

- add automatic changelog generation with standard-version ([380ee82](https://github.com/radleta/just-one/commit/380ee826e93c900df52c189dd495909794ce1a84))

### Bug Fixes

- read version from package.json instead of hardcoded value ([3803889](https://github.com/radleta/just-one/commit/3803889d2349d0a03d42ccbc45412bb0908ae895))

## [1.0.0] - 2026-01-29

### Added

- PID reuse protection: verifies process identity before killing by comparing PID file modification time with process start time
- New dependency: [pidusage](https://github.com/soyuka/pidusage) for cross-platform process metrics
- Automatic changelog generation using [standard-version](https://github.com/conventional-changelog/standard-version)

### Changed

- `handleRun()` and `handleKill()` now verify process identity before killing
- Updated documentation to reflect PID reuse protection feature
- Release workflow now uses `npm run release` instead of `npm version`

### Fixed

- E2E test "kills previous instance when starting new one" no longer asserts PID uniqueness (PIDs can be reused by the OS)
- Husky pre-commit hook updated to v9 format (removed deprecated `husky.sh` sourcing)

## [0.1.0] - 2026-01-22

### Added

- Initial release
- CLI tool to ensure only one instance of a command runs at a time
- PID file management for tracking processes
- Cross-platform support (Windows, macOS, Linux)
- Commands: run with `-n`, kill with `-k`, list with `-l`
- Options: `--pid-dir`, `--quiet`, `--help`, `--version`
- Signal handling for graceful shutdown (SIGINT, SIGTERM)
- Published as scoped package `@radleta/just-one`
