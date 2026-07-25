#!/usr/bin/env node
// Applies code changes described in "data files". Each data file contains one
// or more '-8<---' delimited blocks. A block is structured as:
//
//   -8<---
//   { "target": "relative/path.js", "purpose": "..." }
//   ```old
//   <exact old source snippet>
//   ```new
//   <replacement source snippet>
//   -8<---
//
// The script is strict on purpose: an OLD snippet must exist exactly once in
// the target, otherwise the block is skipped and the run fails. No partial
// edits are written. This makes the data files the single source of truth and
// fails safe when a snippet has drifted from the real code.

'use strict';

const fs = require('fs');
const path = require('path');

const dataFiles = process.argv.slice(2);
if (dataFiles.length === 0) {
  console.error('Usage: node apply_changes.js <datafile> [datafile ...]');
  process.exit(1);
}

// A block is everything between two '-8<---' markers (or EOF).
const BLOCK_RE = /-8<---\s*\n([\s\S]*?)(?=\n-8<---|$)/g;
// Inside a block, split the OLD and NEW code by the ```old / ```new fences.
const OLD_NEW_RE = /```old\s*\n([\s\S]*?)\n```new\s*\n([\s\S]*?)\s*$/;

let failures = 0;
let applied = 0;

for (const file of dataFiles) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`MISSING data file: ${file}`);
    failures++;
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  let m;
  let bi = 0;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    bi++;
    const block = m[1];
    const fenceIdx = block.indexOf('```old');
    if (fenceIdx === -1) {
      console.error(`  [${file}#${bi}] malformed block (no \`\`\`old fence)`);
      failures++;
      continue;
    }
    const headerRaw = block.slice(0, fenceIdx).trim();
    let header;
    try {
      header = JSON.parse(headerRaw);
    } catch (e) {
      console.error(`  [${file}#${bi}] invalid JSON header: ${e.message}`);
      failures++;
      continue;
    }
    const onMatch = OLD_NEW_RE.exec(block.slice(fenceIdx));
    if (!onMatch) {
      console.error(`  [${file}#${bi}] missing \`\`\`old/\`\`\`new fences`);
      failures++;
      continue;
    }
    const oldCode = onMatch[1];
    const newCode = onMatch[2];
    const target = header.target;
    if (!target) {
      console.error(`  [${file}#${bi}] header missing "target"`);
      failures++;
      continue;
    }
    if (!fs.existsSync(target)) {
      console.error(`  [${file}#${bi}] target not found: ${target}`);
      failures++;
      continue;
    }

    const src = fs.readFileSync(target, 'utf8');
    const count = src.split(oldCode).length - 1;
    if (count === 0) {
      console.error(`  [${file}#${bi}] OLD snippet NOT FOUND in ${target}`);
      failures++;
      continue;
    }
    if (count > 1) {
      console.error(`  [${file}#${bi}] OLD snippet matches ${count} times in ${target} (must be unique)`);
      failures++;
      continue;
    }

    fs.writeFileSync(target, src.replace(oldCode, newCode), 'utf8');
    applied++;
    console.log(`  OK [${file}#${bi}] ${target} — ${header.purpose || '(no purpose given)'}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} block(s) failed; ${applied} block(s) applied. No partial edits were left behind.`);
  process.exit(2);
}
console.log(`\nAll ${applied} change(s) applied.`);
