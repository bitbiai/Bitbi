#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const USE_MARKDOWN = process.argv.includes('--markdown');
const IGNORED_DIRS = new Set([
  '.git',
  '.wrangler',
  '_site',
  'coverage',
  'docs',
  'node_modules',
  'playwright-report',
  'scripts',
  'tests',
  'test-results',
  'workers',
]);
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);

const JS_PATTERNS = Object.freeze([
  ['requestAnimationFrame', /\brequestAnimationFrame\s*\(/g],
  ['cancelAnimationFrame', /\bcancelAnimationFrame\s*\(/g],
  ['setTimeout', /\b(?:window\.)?setTimeout\s*\(/g],
  ['clearTimeout', /\b(?:window\.)?clearTimeout\s*\(/g],
  ['setInterval', /\b(?:window\.)?setInterval\s*\(/g],
  ['clearInterval', /\b(?:window\.)?clearInterval\s*\(/g],
  ['IntersectionObserver', /\bIntersectionObserver\b/g],
  ['ResizeObserver', /\bResizeObserver\b/g],
  ['MutationObserver', /\bMutationObserver\b/g],
  ['scroll listeners', /addEventListener\s*\(\s*['"]scroll['"]/g],
  ['resize listeners', /addEventListener\s*\(\s*['"]resize['"]/g],
  ['visibility listeners', /addEventListener\s*\(\s*['"]visibilitychange['"]/g],
  ['pointer/mouse/touch listeners', /addEventListener\s*\(\s*['"](?:pointer|pointerdown|pointerup|pointerenter|pointerleave|mouse|mousedown|mouseup|mouseover|mousemove|touchstart|touchmove|touchend|touchcancel)/g],
  ['document.hidden guard', /\bdocument\.hidden\b/g],
  ['reduced-motion guard', /prefers-reduced-motion/g],
  ['cleanup/destroy guard', /\b(?:destroy|cleanup|disconnect|removeEventListener)\b/g],
]);

const CSS_PATTERNS = Object.freeze([
  ['@keyframes', /@keyframes\b/g],
  ['animation', /\banimation(?:-[a-z-]+)?\s*:/g],
  ['transition', /\btransition(?:-[a-z-]+)?\s*:/g],
  ['filter', /(?<![-\w])filter\s*:/g],
  ['backdrop-filter', /\bbackdrop-filter\s*:/g],
  ['will-change', /\bwill-change\s*:/g],
  ['prefers-reduced-motion', /prefers-reduced-motion/g],
]);

const HTML_INLINE_PATTERNS = Object.freeze([
  ['inline requestAnimationFrame', /\brequestAnimationFrame\s*\(/g],
  ['inline setTimeout', /\bsetTimeout\s*\(/g],
  ['inline scroll listeners', /addEventListener\s*\(\s*['"]scroll['"]/g],
  ['inline scrollRestoration', /\bscrollRestoration\b/g],
]);

function walkFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(absolutePath);
  }
  return files;
}

function countMatches(content, regex) {
  regex.lastIndex = 0;
  return [...content.matchAll(regex)].length;
}

function countPatternGroup(content, patterns) {
  return Object.fromEntries(patterns.map(([name, regex]) => [name, countMatches(content, regex)]));
}

function sumCounts(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function isNameBoundary(char) {
  return !char || /[\s/>]/.test(char);
}

function findTagEnd(content, startIndex) {
  let quote = '';
  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

function hasSrcAttribute(attrs) {
  let index = 0;
  while (index < attrs.length) {
    while (index < attrs.length && /\s/.test(attrs[index])) index += 1;
    const nameStart = index;
    while (index < attrs.length && !/[\s=/>]/.test(attrs[index])) index += 1;
    const name = attrs.slice(nameStart, index).toLowerCase();
    while (index < attrs.length && /\s/.test(attrs[index])) index += 1;
    const hasValue = attrs[index] === '=';
    if (name === 'src' && hasValue) return true;
    if (!hasValue) continue;
    index += 1;
    while (index < attrs.length && /\s/.test(attrs[index])) index += 1;
    const quote = attrs[index] === '"' || attrs[index] === "'" ? attrs[index] : '';
    if (quote) {
      index += 1;
      while (index < attrs.length && attrs[index] !== quote) index += 1;
      if (index < attrs.length) index += 1;
      continue;
    }
    while (index < attrs.length && !/\s/.test(attrs[index])) index += 1;
  }
  return false;
}

function findClosingScriptTag(content, startIndex) {
  let searchIndex = startIndex;
  while (searchIndex < content.length) {
    const openIndex = content.indexOf('<', searchIndex);
    if (openIndex === -1) return null;
    let index = openIndex + 1;
    if (content[index] !== '/') {
      searchIndex = openIndex + 1;
      continue;
    }
    index += 1;
    while (index < content.length && /\s/.test(content[index])) index += 1;
    if (content.slice(index, index + 6).toLowerCase() !== 'script') {
      searchIndex = openIndex + 1;
      continue;
    }
    index += 6;
    if (!isNameBoundary(content[index])) {
      searchIndex = openIndex + 1;
      continue;
    }
    while (index < content.length && /\s/.test(content[index])) index += 1;
    if (content[index] !== '>') {
      searchIndex = openIndex + 1;
      continue;
    }
    return {
      start: openIndex,
      end: index,
    };
  }
  return null;
}

export function extractInlineScripts(content) {
  const scripts = [];
  let searchIndex = 0;
  while (searchIndex < content.length) {
    const openIndex = content.indexOf('<', searchIndex);
    if (openIndex === -1) break;
    const nameStart = openIndex + 1;
    if (content.slice(nameStart, nameStart + 6).toLowerCase() !== 'script'
      || !isNameBoundary(content[nameStart + 6])) {
      searchIndex = openIndex + 1;
      continue;
    }
    const tagEnd = findTagEnd(content, nameStart + 6);
    if (tagEnd === -1) break;
    const attrs = content.slice(nameStart + 6, tagEnd);
    const close = findClosingScriptTag(content, tagEnd + 1);
    if (!close) break;
    if (!hasSrcAttribute(attrs)) {
      scripts.push(content.slice(tagEnd + 1, close.start));
    }
    searchIndex = close.end + 1;
  }
  return scripts;
}

function classifyJsFile(record) {
  const counts = record.counts;
  const hasLoop = counts.requestAnimationFrame > 0 || counts.setInterval > 0;
  const hasTimer = counts.setTimeout > 0 || counts.setInterval > 0;
  const hasObserver = counts.IntersectionObserver > 0 || counts.ResizeObserver > 0 || counts.MutationObserver > 0;
  const hasLifecycleGuard = counts['document.hidden guard'] > 0
    || counts['visibility listeners'] > 0
    || counts['reduced-motion guard'] > 0
    || counts['cleanup/destroy guard'] > 0;
  if (hasLoop && !hasLifecycleGuard) return 'loop_needs_lifecycle_review';
  if ((hasTimer || hasObserver) && !hasLifecycleGuard) return 'state_lifecycle_review';
  if (hasLifecycleGuard) return 'guarded_or_lifecycle_aware';
  return 'low_runtime_signal';
}

function collectInventory() {
  const files = walkFiles(ROOT);
  const jsFiles = [];
  const cssFiles = [];
  const htmlInline = [];

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf8');
    const stats = fs.statSync(filePath);
    if (ext === '.js' || ext === '.mjs') {
      const counts = countPatternGroup(content, JS_PATTERNS);
      const total = sumCounts(counts);
      if (!total) continue;
      const record = {
        path: relative(filePath),
        bytes: stats.size,
        counts,
        total,
      };
      record.classification = classifyJsFile(record);
      jsFiles.push(record);
      continue;
    }
    if (ext === '.css') {
      const counts = countPatternGroup(content, CSS_PATTERNS);
      const total = sumCounts(counts);
      if (!total) continue;
      cssFiles.push({
        path: relative(filePath),
        bytes: stats.size,
        counts,
        total,
        classification: counts['prefers-reduced-motion'] > 0
          ? 'has_reduced_motion_coverage'
          : 'animation_effect_review',
      });
      continue;
    }
    if (ext === '.html') {
      const scripts = extractInlineScripts(content);
      const aggregate = Object.fromEntries(HTML_INLINE_PATTERNS.map(([name]) => [name, 0]));
      scripts.forEach((script) => {
        const counts = countPatternGroup(script, HTML_INLINE_PATTERNS);
        Object.entries(counts).forEach(([name, count]) => {
          aggregate[name] += count;
        });
      });
      const total = sumCounts(aggregate);
      if (!total) continue;
      htmlInline.push({
        path: relative(filePath),
        bytes: stats.size,
        counts: aggregate,
        total,
        inlineScripts: scripts.length,
        classification: 'inline_runtime_review',
      });
    }
  }

  jsFiles.sort((left, right) => right.total - left.total || right.bytes - left.bytes || left.path.localeCompare(right.path));
  cssFiles.sort((left, right) => right.total - left.total || right.bytes - left.bytes || left.path.localeCompare(right.path));
  htmlInline.sort((left, right) => right.total - left.total || right.bytes - left.bytes || left.path.localeCompare(right.path));

  return { jsFiles, cssFiles, htmlInline };
}

function aggregateCounts(records, patternNames) {
  return patternNames.map((name) => [
    name,
    records.reduce((sum, record) => sum + (record.counts[name] || 0), 0),
  ]);
}

function renderTable(headers, rows) {
  if (!USE_MARKDOWN) {
    const widths = headers.map((header, index) => Math.max(
      header.length,
      ...rows.map((row) => String(row[index]).length),
    ));
    const rowLine = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ');
    return [rowLine(headers), rowLine(widths.map((width) => '-'.repeat(width))), ...rows.map(rowLine)].join('\n');
  }
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function countColumns(record, names) {
  return names.map((name) => record.counts[name] || 0);
}

function printReport() {
  const inventory = collectInventory();
  const jsHotspotNames = [
    'requestAnimationFrame',
    'setTimeout',
    'setInterval',
    'IntersectionObserver',
    'ResizeObserver',
    'MutationObserver',
    'scroll listeners',
    'resize listeners',
    'visibility listeners',
    'document.hidden guard',
    'reduced-motion guard',
  ];
  const cssHotspotNames = ['@keyframes', 'animation', 'transition', 'filter', 'backdrop-filter', 'will-change', 'prefers-reduced-motion'];
  const htmlHotspotNames = ['inline requestAnimationFrame', 'inline setTimeout', 'inline scroll listeners', 'inline scrollRestoration'];

  const lines = [];
  lines.push(USE_MARKDOWN ? '# BITBI Runtime Work Inventory' : 'BITBI Runtime Work Inventory');
  lines.push('');
  lines.push(`Analysis root: ${path.relative(process.cwd(), ROOT) || '.'}`);
  lines.push(`JS files with runtime signals: ${inventory.jsFiles.length}`);
  lines.push(`CSS files with animation/effect signals: ${inventory.cssFiles.length}`);
  lines.push(`HTML files with inline runtime signals: ${inventory.htmlInline.length}`);
  lines.push('');

  lines.push(USE_MARKDOWN ? '## JS Runtime Signal Totals' : 'JS runtime signal totals');
  lines.push(renderTable(['Signal', 'Count'], aggregateCounts(inventory.jsFiles, jsHotspotNames)));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Top JS Runtime Hotspots' : 'Top JS runtime hotspots');
  lines.push(renderTable(
    ['Path', 'Bytes', 'Human', 'rAF', 'Timers', 'Observers', 'Listeners', 'Guards', 'Class'],
    inventory.jsFiles.slice(0, 30).map((record) => {
      const timers = (record.counts.setTimeout || 0) + (record.counts.setInterval || 0);
      const observers = (record.counts.IntersectionObserver || 0)
        + (record.counts.ResizeObserver || 0)
        + (record.counts.MutationObserver || 0);
      const listeners = (record.counts['scroll listeners'] || 0)
        + (record.counts['resize listeners'] || 0)
        + (record.counts['visibility listeners'] || 0)
        + (record.counts['pointer/mouse/touch listeners'] || 0);
      const guards = (record.counts['document.hidden guard'] || 0)
        + (record.counts['reduced-motion guard'] || 0)
        + (record.counts['cleanup/destroy guard'] || 0);
      return [
        record.path,
        record.bytes,
        formatBytes(record.bytes),
        record.counts.requestAnimationFrame || 0,
        timers,
        observers,
        listeners,
        guards,
        record.classification,
      ];
    }),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## CSS Animation And Compositor Signals' : 'CSS animation and compositor signals');
  lines.push(renderTable(['Signal', 'Count'], aggregateCounts(inventory.cssFiles, cssHotspotNames)));
  lines.push('');
  lines.push(renderTable(
    ['Path', 'Bytes', 'Human', ...cssHotspotNames, 'Class'],
    inventory.cssFiles.slice(0, 20).map((record) => [
      record.path,
      record.bytes,
      formatBytes(record.bytes),
      ...countColumns(record, cssHotspotNames),
      record.classification,
    ]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## HTML Inline Runtime Signals' : 'HTML inline runtime signals');
  lines.push(renderTable(
    ['Path', 'Bytes', 'Human', 'Inline scripts', ...htmlHotspotNames, 'Class'],
    inventory.htmlInline.slice(0, 20).map((record) => [
      record.path,
      record.bytes,
      formatBytes(record.bytes),
      record.inlineScripts,
      ...countColumns(record, htmlHotspotNames),
      record.classification,
    ]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Review Notes' : 'Review notes');
  const notes = [
    'Counts are static source signals, not measured browser frame cost.',
    'Files classified as lifecycle-aware can still be expensive; inspect before changing behavior.',
    'Inline homepage scroll restoration is intentionally flagged for review because it schedules repeated restore attempts on reload.',
  ];
  if (USE_MARKDOWN) {
    notes.forEach((note) => lines.push(`- ${note}`));
  } else {
    notes.forEach((note) => lines.push(`- ${note}`));
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  printReport();
}
