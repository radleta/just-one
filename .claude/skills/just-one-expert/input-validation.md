---
tags: [just-one-expert/input-validation]
summary: "What must be validated before a value reaches a shell command or a file path, and where each check lives"
page-kind: reference
---
# Input validation

Two kinds of input reach something dangerous: a PID reaches a shell command, and a name or
directory becomes a file path. Each has one check, and every new use goes through it.

## PIDs before a shell command

- `taskkill` and `tasklist` run through `execSync` with the PID interpolated into the command
  string. The PID must pass [`process.ts` `isValidPid`](../../../src/lib/process.ts) first, which
  admits only an integer in range; an integer cannot carry shell syntax.
- Every `process.ts` function that hands a PID to the OS re-checks `isValidPid` itself rather than
  trusting its caller. Keep that: [`pid.ts` `readPidRecord`](../../../src/lib/pid.ts) rejects only
  non-numbers and values at or below zero, so a PID from disk is not proven in range.
- A new `execSync` interpolation takes a validated integer and nothing else. For anything else,
  pass an argument array with `execFileSync`, as `getProcessLstart` does.

## Names and directories before a file path

- A process name becomes `<pid-dir>/<name>.pid` and `<name>.log`.
  [`lib/cli.ts` `isValidName`](../../../src/lib/cli.ts) rejects `/`, `\`, `..`, a name of only
  dots or whitespace, and anything longer than `MAX_NAME_LENGTH`.
- `--pid-dir` goes through `isValidPidDir` in the same file, which rejects `..` and over-long
  paths. An absolute directory is allowed on purpose (`README.md` shows `-d /tmp`).
- A new option that becomes a path gets the same check in `parseArgs`, before any handler runs.
  The rejection cases are covered in `src/lib/cli.test.ts`; add the new option's there.
