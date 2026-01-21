#!/usr/bin/env node

/**
 * Verify package contents before publishing
 *
 * This script performs a dry-run of npm pack and checks:
 * - Package size is reasonable
 * - No unwanted files are included
 * - File count is acceptable
 */

import { execSync } from 'child_process';

console.log('🔍 Verifying package contents...\n');

let output;
try {
  // Create dry-run package
  output = execSync('npm pack --dry-run 2>&1', { encoding: 'utf-8' });
} catch (error) {
  console.error('✗ Failed to run npm pack --dry-run');
  console.error(error.message);
  process.exit(1);
}

console.log(output);

// Extract package size
const sizeMatch = output.match(/package size:\s+([\d.]+\s+\w+)/);
const size = sizeMatch ? sizeMatch[1] : 'unknown';

console.log(`\n✓ Package size: ${size}`);

// Extract file count from lines that start with "npm notice" and contain a file path
const fileLines = output.split('\n').filter(line =>
  line.startsWith('npm notice') && line.includes('/')
);
const fileCount = fileLines.length;

console.log(`✓ File count: ${fileCount}`);

// Check for unwanted files
const unwantedPatterns = [
  { pattern: /\btests?\//, name: 'test files (tests/)' },
  { pattern: /\bdist\/tests\//, name: 'compiled test files (dist/tests/)' },
  { pattern: /\.test\.[jt]sx?/, name: 'test files (*.test.*)' },
  { pattern: /\.spec\.[jt]sx?/, name: 'spec files (*.spec.*)' },
  { pattern: /\bcoverage\//, name: 'coverage files' },
  { pattern: /\bnode_modules\//, name: 'node_modules' },
  { pattern: /tsconfig\.json/, name: 'tsconfig.json' },
  { pattern: /eslint\.config\.[jt]s/, name: 'eslint config' },
  { pattern: /\.prettierrc/, name: 'prettier config' },
  { pattern: /\.github\//, name: '.github directory' },
  { pattern: /\.husky\//, name: '.husky directory' },
  { pattern: /\bscripts\//, name: 'scripts directory' },
  { pattern: /\breference\//, name: 'reference directory' },
];

const unwantedFiles = [];

for (const line of fileLines) {
  for (const { pattern, name } of unwantedPatterns) {
    if (pattern.test(line)) {
      unwantedFiles.push({ line: line.trim(), type: name });
    }
  }
}

if (unwantedFiles.length > 0) {
  console.log('\n✗ Unwanted files detected:');
  const grouped = {};
  for (const { line, type } of unwantedFiles) {
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(line);
  }
  for (const [type, lines] of Object.entries(grouped)) {
    console.log(`\n  ${type}:`);
    lines.forEach(line => console.log(`    ${line}`));
  }
  console.log('\n⚠ Fix .npmignore or files array in package.json');
  process.exit(1);
}

// Check size limits (warn only, don't fail)
const sizeLimits = {
  zipped: 30 * 1024,   // 30 KB
  files: 15
};

if (fileCount > sizeLimits.files) {
  console.log(`\n⚠ File count (${fileCount}) exceeds target (${sizeLimits.files})`);
}

// Parse size (convert to bytes for comparison)
if (size !== 'unknown') {
  const sizeValue = parseFloat(size);
  const sizeUnit = size.match(/[a-zA-Z]+/)?.[0].toLowerCase();
  let sizeInKB = 0;

  if (sizeUnit === 'kb' || sizeUnit === 'k') {
    sizeInKB = sizeValue;
  } else if (sizeUnit === 'mb' || sizeUnit === 'm') {
    sizeInKB = sizeValue * 1024;
  } else if (sizeUnit === 'b') {
    sizeInKB = sizeValue / 1024;
  }

  if (sizeInKB > sizeLimits.zipped / 1024) {
    console.log(`⚠ Package size (${size}) exceeds target (${sizeLimits.zipped / 1024} KB)`);
  }
}

console.log('\n✓ Package contents verified');
console.log('\nPackage is ready for publishing');
