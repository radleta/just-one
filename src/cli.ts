#!/usr/bin/env node
/**
 * CLI entry point for just-one.
 *
 * This file is the side-effect entry: it imports main() and calls it.
 * Separated from index.ts (which is a pure library export) to prevent
 * the ESM dual-loading hazard where the same module loaded under two
 * different URLs would execute main() twice, causing doubled output.
 */

import { main } from './index.js';

main()
  .then(code => {
    // Always explicitly exit with the returned code.
    // For foreground/tail modes, main() returns a never-resolving promise,
    // so this handler is never reached — those modes exit via their own
    // child.on('exit') or cleanup handlers calling process.exit() directly.
    process.exit(code);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
