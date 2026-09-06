import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Preserve exact SQL bytes, including quoted semicolons and trigger bodies.
// This lexer splits statements; actual native D1 remains the SQL validator.
export function splitSql(source) {
  const statements = [];
  let start = 0, quote = null, comment = null, trigger = false, depth = 0, hasCode = false;
  let words = [];
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i], next = source[i + 1];
    if (comment === 'line') { if (c === '\n') comment = null; continue; }
    if (comment === 'block') { if (c === '*' && next === '/') { comment = null; i += 1; } continue; }
    if (quote) {
      if (c === quote) { if (next === quote && quote !== ']') i += 1; else quote = null; }
      continue;
    }
    if (c === '-' && next === '-') { comment = 'line'; i += 1; continue; }
    if (c === '/' && next === '*') { comment = 'block'; i += 1; continue; }
    if (['\'', '"', '`', '['].includes(c)) { quote = c === '[' ? ']' : c; hasCode = true; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let end = i + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end += 1;
      const word = source.slice(i, end).toUpperCase();
      words.push(word); hasCode = true; i = end - 1;
      if (word === 'TRIGGER' && words[0] === 'CREATE') trigger = true;
      if (trigger && (word === 'BEGIN' || (depth > 0 && word === 'CASE'))) depth += 1;
      if (trigger && word === 'END' && depth > 0) depth -= 1;
      continue;
    }
    if (c === ';' && depth === 0) {
      if (hasCode) statements.push(source.slice(start, i + 1));
      start = i + 1; words = []; trigger = false; hasCode = false;
    } else if (!/\s/.test(c)) hasCode = true;
  }
  if (quote || comment === 'block' || depth) throw new Error('Incomplete SQL fixture');
  if (hasCode) throw new Error('Migration must terminate its last SQL statement with a semicolon');
  const tail = source.slice(start);
  if (statements.join('') + tail !== source) throw new Error('SQL segmentation changed source bytes');
  return { statements, tail };
}

export function readMigrations(repoRoot) {
  const directory = path.join(repoRoot, 'workers/auth/migrations');
  return fs.readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort().map(name => {
    const source = fs.readFileSync(path.join(directory, name), 'utf8');
    return { path: name, source, sha256: sha256(source), ...splitSql(source) };
  });
}

export function referenceView(sql) {
  const statement = splitSql(sql).statements.find(value => /CREATE VIEW r2_cleanup_live_references AS/.test(value));
  if (!statement) throw new Error('Reference view missing from actual migration');
  return statement.slice(statement.indexOf('CREATE VIEW'));
}
