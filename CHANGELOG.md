# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- PID reuse protection: verifies process identity before killing by comparing PID file modification time with process start time
- New dependency: [pidusage](https://github.com/soyuka/pidusage) for cross-platform process metrics

### Changed

- `handleRun()` and `handleKill()` now verify process identity before killing
- Updated documentation to reflect PID reuse protection feature

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
