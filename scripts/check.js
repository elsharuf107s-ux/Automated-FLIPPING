// Syntax-checks every JavaScript file in the project (server, browser and tests).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['server.js', 'lib', 'public', 'scripts', 'test'];
const files = [];

function walk(entry) {
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) fs.readdirSync(entry).forEach((name) => walk(path.join(entry, name)));
  else if (entry.endsWith('.js')) files.push(entry);
}

roots.filter((root) => fs.existsSync(root)).forEach(walk);
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log(`Syntax OK: ${files.length} files`);
