# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.4.0](https://github.com/radleta/just-one/compare/v1.3.1...v1.4.0) (2026-02-12)

### Features

- **log:** capture stdout/stderr to log file in foreground mode ([f587b40](https://github.com/radleta/just-one/commit/f587b4073c3d419649cb0e01c3e08f11abb34ba3))

### Bug Fixes

- handle log stream errors and improve process.ts test coverage ([a40fcc9](https://github.com/radleta/just-one/commit/a40fcc9c2433bdadba4efd660b29e0833dbc2c78))
- **test:** stabilize flaky "kills a running process" e2e test ([2cc9067](https://github.com/radleta/just-one/commit/2cc9067f2563d323abf8fb404f643f72584b4713))
- **test:** use Windows-safe cleanup in global e2e beforeEach/afterEach ([09d5a00](https://github.com/radleta/just-one/commit/09d5a001b42cba5be329050d8f79d428358718cc))

## [1.3.1](https://github.com/radleta/just-one/compare/v1.3.0...v1.3.1) (2026-02-12)

### Bug Fixes

- **cli:** print PID to stdout even in quiet mode so `pid=$(just-one -p name -q)` works ([#6](https://github.com/radleta/just-one/issues/6))
- **clean:** detect and remove orphaned log files that have no matching PID file ([#7](https://github.com/radleta/just-one/issues/7))
- **daemon:** auto-create PID directory before opening log file in daemon mode ([#8](https://github.com/radleta/just-one/issues/8))

## [1.3.0](https://github.com/radleta/just-one/compare/v1.2.0...v1.3.0) (2026-02-12)

### Features

- **cli:** add daemon mode with log capture, viewing, and real-time follow ([4b6b7ae](https://github.com/radleta/just-one/commit/4b6b7ae84117c895782d272aa0ae62f107fb2e13))
- **process:** add graceful kill with SIGKILL escalation and --grace flag ([84f90d9](https://github.com/radleta/just-one/commit/84f90d90652f376bcac9ae781967578a657c3dd4))

### Bug Fixes

- **ci:** enforce LF line endings to fix Windows format check ([e208149](https://github.com/radleta/just-one/commit/e2081493b21663011ef9431944bd25eb22d121aa))
- **log:** replace fs.watchFile with setInterval polling in tailLogFile ([26200fc](https://github.com/radleta/just-one/commit/26200fcb47632800fecb508b85696ad3ceffadea))
- **process:** pass args array to spawn on Windows instead of joining ([5e3d13a](https://github.com/radleta/just-one/commit/5e3d13ace04175dfb92404bd06aac2e1dadcf04d))
- **process:** remove shell: true from daemon mode on Windows ([2411f5f](https://github.com/radleta/just-one/commit/2411f5f8a7ee43aac00d784a360d996d02fb715d))
- **tests:** increase tailLogFile poll timeout for slow CI runners ([bde9a92](https://github.com/radleta/just-one/commit/bde9a92839f986e0270ca9fb5f81ea98d9228aef))
- **tests:** stabilize flaky polling-based tests ([02d4639](https://github.com/radleta/just-one/commit/02d463928b3e4f59829babd24bd74549c6fc9a68))
- **tests:** stabilize Windows E2E tests for daemon mode ([92dee91](https://github.com/radleta/just-one/commit/92dee9100d0eae133d5db045e0c65425fb73669f))
- **tests:** use script files instead of node -e in daemon tests ([bc47ab5](https://github.com/radleta/just-one/commit/bc47ab5ab98076813bedb58dd3a7d869d3e738e7))

## [1.2.0](https://github.com/radleta/just-one/compare/v1.1.0...v1.2.0) (2026-02-11)

### Features

- **cli:** add status, kill-all, ensure, clean, pid, and wait operations ([5d1909b](https://github.com/radleta/just-one/commit/5d1909bc794a7a5b357d725fa59c7942dca7023d))

### Bug Fixes

- **windows:** allow child process to run cleanup handlers on Ctrl+C ([ac3bca0](https://github.com/radleta/just-one/commit/ac3bca07fcbfeb39e98ad3f31c280b45152525e0))

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
