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
    // Only exit if we're not running a child process
    // The child process exit handler will call process.exit
    if (code !== 0) {
      process.exit(code);
    }
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
