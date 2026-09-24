---
tags: [just-one-expert/architecture]
summary: "Where code goes and why: pure logic in `src/lib` behind the coverage gate, the import direction between `pid.ts` and `process.ts`, the pure library entry versus the CLI entry, and what `bin/` wraps"
page-kind: reference
---
# Architecture

## Where code goes

- **Logic lives in `src/lib/`.** The coverage gate covers only `src/lib/**`
  ([`vitest.config.ts` `coverage`](../../../vitest.config.ts)), so the handlers in `src/index.ts` sit
  outside it. Keep the handlers thin: they read options, call `lib` functions and print. Anything
  with a branch worth testing moves into `lib`. That is why
  [`process.ts` `describeRejection`](../../../src/lib/process.ts) lives beside the verdict rather
  than in `index.ts`: every message it can produce is provable inside the gate, and nothing new is
  exported from the published entry point.
- **Two entry points.** `src/index.ts` (built to `dist/index.js`) is the published library export
  and has no top-level side effects. `src/cli.ts` (built to `dist/cli.js`) is the only file that
  calls `main()` and `process.exit`; its header gives the reason (the ESM dual-loading hazard). Never
  add a top-level side effect to `index.ts` or to anything it imports. The entries are listed in
  [`tsup.config.ts` `entry`](../../../tsup.config.ts).
- **Import direction.** `process.ts` imports `pid.ts` and `windows-spawn.ts`; `pid.ts` imports no
  other module of this repo. A check that needs process liveness therefore cannot live in `pid.ts`:
  `pid.ts` returns the data (the writer PID, for example) and the handler filters.
  `listTempPidFiles`'s doc comment is the example.

## Module map

- [`src/index.ts`](../../../src/index.ts): `main()` and one `handle*` function per mode. Parses,
  dispatches, prints, and returns an exit code. The library export.
- [`src/cli.ts`](../../../src/cli.ts): the side-effect entry. Calls `main()` and turns its result
  into `process.exit`.
- [`src/lib/cli.ts`](../../../src/lib/cli.ts): argv parsing, option validation (see
  [input-validation](input-validation.md)), and the help text.
- [`src/lib/pid.ts`](../../../src/lib/pid.ts): the PID file on disk (format, atomic write, read,
  delete, list, orphaned `.tmp` listing). Knows nothing about processes. See [pid-file](pid-file.md).
- [`src/lib/process.ts`](../../../src/lib/process.ts): everything about live processes: liveness,
  identity verdicts and rejection text, kill and terminate, foreground and daemon spawn, signal
  forwarding. See [process-killing](process-killing.md), [process-identity](process-identity.md)
  and [spawn-and-signals](spawn-and-signals.md).
- [`src/lib/log.ts`](../../../src/lib/log.ts): log paths, rotation, reading the last lines, the
  polling tail, orphaned-log listing.
- [`src/lib/windows-spawn.ts`](../../../src/lib/windows-spawn.ts): Windows-only launch with no
  inherited handles through koffi, and its pure command-line quoting. See
  [windows-daemon](windows-daemon.md).
- [`bin/just-one.js`](../../../bin/just-one.js): the npm `bin` shim. Imports `dist/cli.js`, so the
  CLI runs only after `npm run build`.
- [`bin/daemon-helper.js`](../../../bin/daemon-helper.js): the Windows daemon wrapper. Plain
  JavaScript shipped as is: not compiled, not linted (`lint` covers `src` only), not under the
  coverage gate. `process.ts` finds it at run time by walking up from its own directory
  (`getDaemonHelperPath`), which works from both `dist/` and `src/lib/`.
- Tests sit beside the module they cover (`src/lib/<module>.test.ts`); the end-to-end suite is
  `src/e2e/cli.e2e.test.ts` and runs the built CLI. See [testing](testing.md).

## Adding a mode or an exit code

A new mode is a `handle*` function in `index.ts`, dispatched from `main()`, with its logic in `lib`.
A new exit code is user-facing: add it to `README.md` § Exit Codes in the same change.
