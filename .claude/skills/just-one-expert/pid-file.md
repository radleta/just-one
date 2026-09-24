---
tags: [just-one-expert/pid-file]
summary: "The PID file as a shared on-disk contract: its format rules, atomic write and orphaned `.tmp` reclaim, mtime preservation, compatibility with older just-one versions, and the accepted same-name race"
page-kind: reference
---
# PID file

`<pid-dir>/<name>.pid` is read by every version of just-one that shares the directory, so its shape
is a contract, not an implementation detail. What goes in it as identity evidence is
[process-identity](process-identity.md).

## Format

The doc comments of [`pid.ts` `readPidRecord` and `formatPidFile`](../../../src/lib/pid.ts) own the
format: the PID alone on line 1, then optional `key=value` lines. The rules that follow from it:

- Nothing ever goes before the PID on line 1. Older versions `parseInt` the whole file and stop at
  the first newline; that is the only reason they can read a new file.
- At most one evidence key per file. `formatPidFile` writes ticks when both are supplied.
- A `startTime=` value is read back through the source that wrote it (`lstart` on macOS, pidusage
  elsewhere). Crossing them compares whole seconds against milliseconds and never matches.
- `readPidRecord` tolerates CRLF, ignores unknown keys, and treats a missing, empty or non-numeric
  value as no evidence (the empty case is explained in `readNumericKey`). A new key is therefore
  safe to add: old readers skip it.

## Writing

- **Atomic.** [`pid.ts` `writePid`](../../../src/lib/pid.ts) writes a `.tmp` sibling and renames it
  into place; its comment says why. Keep every write going through `writePid`.
- **Orphaned `.tmp`.** A write killed between its write and its rename leaves
  `<name>.pid.<writerPid>.tmp`. Every other path filters on the `.pid` suffix, so nothing but
  `--clean` sees it. `--clean` removes one whose writer PID is dead and spares one whose writer is
  alive (a write in flight). The liveness check sits in `index.ts` `handleClean`, not in `pid.ts`,
  because `pid.ts` cannot import `process.ts` (see `listTempPidFiles`'s doc comment and
  [architecture](architecture.md)).
- **mtime preserved.** [`pid.ts` `writeIdentityEvidence`](../../../src/lib/pid.ts) restores the
  file's mtime after adding evidence, on the final path after the rename; its doc comment gives the
  reason. Pass `utimesSync` float seconds, never `Date` objects, which truncate to whole
  milliseconds. The restore is still not bit-exact on a filesystem with a sub-microsecond mtime tail
  (APFS, ext4): float seconds near 1.8e9 run out of double precision first and lose about
  0.0005 ms. Tests assert it to within 1 ms (see [testing](testing.md)).

## Compatibility with older versions

Verified against a real 1.4.2 install, in both directions: an old version reads a new file
correctly (its `parseInt` stops at the newline), and a new version reads a legacy bare-PID file and
falls back to the mtime path. A PID directory shared by mixed versions is safe. Three things keep it
safe, and each must stay: the PID alone on line 1, the atomic rename, and the preserved mtime.

## Lifetime

- The PID file is deliberately kept when a foreground child exits. The comment
  "We intentionally do NOT delete the PID file on exit" in
  [`index.ts` `handleRun`](../../../src/index.ts) owns the reason. An orphaned PID file is normal:
  the next run verifies it and deletes it. Do not add exit-time cleanup.
- **Same-name race, accepted.** No lock spans `handleRun`'s read of the old record and its
  `writePid` of the new one. Two same-name starts at the same moment can both find no record and
  both spawn; the later rename wins and the other process runs untracked. This is rare in practice
  and accepted for dev tooling. Do not add locking without the owner deciding to.
