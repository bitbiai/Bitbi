#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const BUILD_DIR = path.join(ROOT, '_site');
const USE_MARKDOWN = process.argv.includes('--markdown');
const ANALYSIS_ROOT = fs.existsSync(BUILD_DIR) ? BUILD_DIR : ROOT;
const ANALYSIS_LABEL = ANALYSIS_ROOT === BUILD_DIR ? '_site' : 'source';

const KEY_HTML_PAGES = Object.freeze([
  'index.html',
  'de/index.html',
  'generate-lab/index.html',
  'de/generate-lab/index.html',
  'admin/index.html',
]);

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.txt',
  '.xml',
  '.svg',
]);

function categoryForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'html';
  if (ext === '.js' || ext === '.mjs') return 'js';
  if (ext === '.css') return 'css';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico'].includes(ext)) return 'image';
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'font';
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'].includes(ext)) return 'audio';
  return 'other';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function walkFiles(rootDir) {
  const files = [];
  const ignoredNames = new Set(['.git', 'node_modules', '.wrangler', 'coverage', 'test-results']);

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredNames.has(entry.name)) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile()) files.push(absolutePath);
    }
  }

  walk(rootDir);
  return files;
}

function fileRecord(filePath, rootDir = ANALYSIS_ROOT) {
  const stats = fs.statSync(filePath);
  const relativePath = path.relative(rootDir, filePath).split(path.sep).join('/');
  return {
    path: relativePath,
    bytes: stats.size,
    category: categoryForFile(filePath),
  };
}

function getAssetSummary(files) {
  const categories = new Map();
  for (const file of files) {
    const existing = categories.get(file.category) || { files: 0, bytes: 0 };
    existing.files += 1;
    existing.bytes += file.bytes;
    categories.set(file.category, existing);
  }
  return [...categories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, value]) => ({ category, ...value }));
}

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function countMatches(content, regex) {
  if (!content) return 0;
  return [...content.matchAll(regex)].length;
}

function getHtmlReferenceSummary() {
  return KEY_HTML_PAGES.map((pagePath) => {
    const content = readIfExists(path.join(ANALYSIS_ROOT, pagePath));
    if (!content) {
      return { pagePath, exists: false, cssLinks: 0, moduleScripts: 0, preloadLinks: 0 };
    }
    return {
      pagePath,
      exists: true,
      cssLinks: countMatches(content, /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi),
      moduleScripts: countMatches(content, /<script\b[^>]*type=["']module["'][^>]*>/gi),
      preloadLinks: countMatches(content, /<link\b[^>]*rel=["']preload["'][^>]*>/gi),
    };
  });
}

function countAssetVersionPlaceholders() {
  if (!fs.existsSync(BUILD_DIR)) return { checked: false, count: 0, files: [] };
  const files = walkFiles(BUILD_DIR);
  const matches = [];
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const content = readIfExists(filePath);
    if (!content || !content.includes('__ASSET_VERSION__')) continue;
    matches.push(path.relative(BUILD_DIR, filePath).split(path.sep).join('/'));
  }
  return { checked: true, count: matches.length, files: matches };
}

function stripQuery(specifier) {
  const index = specifier.indexOf('?');
  return index === -1 ? specifier : specifier.slice(0, index);
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const cleanSpecifier = stripQuery(specifier);
  const basePath = path.resolve(path.dirname(fromFile), cleanSpecifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.mjs'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function extractStaticImports(content) {
  if (!content) return [];
  const imports = [];
  const fromMatches = content.matchAll(/^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]\s*;?/gm);
  for (const match of fromMatches) imports.push(match[1]);
  return imports;
}

function extractDynamicImports(content) {
  if (!content) return [];
  const imports = [];
  const matches = content.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm);
  for (const match of matches) imports.push(match[1]);
  return imports;
}

function buildStaticImportGraph(entryRelativePath) {
  const entryPath = path.join(ROOT, entryRelativePath);
  if (!fs.existsSync(entryPath)) {
    return { exists: false, entryRelativePath, modules: [], totalBytes: 0, dynamicImports: [] };
  }

  const visited = new Set();
  const modules = [];
  const dynamicImports = new Set();

  function visit(filePath) {
    const normalizedPath = path.normalize(filePath);
    if (visited.has(normalizedPath)) return;
    visited.add(normalizedPath);

    const content = readIfExists(normalizedPath);
    if (!content) return;

    const stats = fs.statSync(normalizedPath);
    modules.push({
      path: path.relative(ROOT, normalizedPath).split(path.sep).join('/'),
      bytes: stats.size,
    });

    for (const specifier of extractDynamicImports(content)) {
      const resolvedDynamic = resolveImport(normalizedPath, specifier);
      dynamicImports.add(resolvedDynamic
        ? path.relative(ROOT, resolvedDynamic).split(path.sep).join('/')
        : specifier);
    }

    for (const specifier of extractStaticImports(content)) {
      const resolved = resolveImport(normalizedPath, specifier);
      if (resolved) visit(resolved);
    }
  }

  visit(entryPath);
  modules.sort((left, right) => right.bytes - left.bytes);
  return {
    exists: true,
    entryRelativePath,
    modules,
    totalBytes: modules.reduce((sum, moduleInfo) => sum + moduleInfo.bytes, 0),
    dynamicImports: [...dynamicImports].sort(),
  };
}

function renderTable(headers, rows) {
  if (!USE_MARKDOWN) {
    const widths = headers.map((header, index) => Math.max(
      header.length,
      ...rows.map((row) => String(row[index]).length),
    ));
    const renderRow = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ');
    return [renderRow(headers), renderRow(widths.map((width) => '-'.repeat(width))), ...rows.map(renderRow)].join('\n');
  }

  const headerLine = `| ${headers.join(' | ')} |`;
  const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => `| ${row.join(' | ')} |`);
  return [headerLine, dividerLine, ...rowLines].join('\n');
}

function printReport() {
  const files = walkFiles(ANALYSIS_ROOT).map((filePath) => fileRecord(filePath));
  const categories = getAssetSummary(files);
  const largestFiles = [...files].sort((left, right) => right.bytes - left.bytes).slice(0, 30);
  const htmlSummary = getHtmlReferenceSummary();
  const assetVersion = countAssetVersionPlaceholders();
  const importGraph = buildStaticImportGraph('js/pages/index/main.js');

  const lines = [];
  lines.push(USE_MARKDOWN ? '# BITBI Performance Inventory' : 'BITBI Performance Inventory');
  lines.push('');
  lines.push(`Analysis root: ${ANALYSIS_LABEL}`);
  lines.push(`Total files scanned: ${files.length}`);
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Bytes by Category' : 'Bytes by category');
  lines.push(renderTable(
    ['Category', 'Files', 'Bytes', 'Human'],
    categories.map((row) => [row.category, row.files, row.bytes, formatBytes(row.bytes)]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Largest Files' : 'Largest files');
  lines.push(renderTable(
    ['Rank', 'Path', 'Bytes', 'Human'],
    largestFiles.map((file, index) => [index + 1, file.path, file.bytes, formatBytes(file.bytes)]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Key HTML Entry References' : 'Key HTML entry references');
  lines.push(renderTable(
    ['Page', 'Exists', 'CSS links', 'Module scripts', 'Preloads'],
    htmlSummary.map((row) => [row.pagePath, row.exists ? 'yes' : 'no', row.cssLinks, row.moduleScripts, row.preloadLinks]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Asset Version Placeholders' : 'Asset version placeholders');
  if (!assetVersion.checked) {
    lines.push('_site was not present, so build-output placeholder scanning was skipped.');
  } else if (assetVersion.count === 0) {
    lines.push('No unresolved __ASSET_VERSION__ placeholders found in _site.');
  } else {
    lines.push(`${assetVersion.count} files contain unresolved __ASSET_VERSION__ placeholders:`);
    for (const filePath of assetVersion.files) lines.push(`- ${filePath}`);
  }
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Homepage Initial Static Import Graph' : 'Homepage initial static import graph');
  if (!importGraph.exists) {
    lines.push(`${importGraph.entryRelativePath} was not found.`);
  } else {
    lines.push(`Entry: ${importGraph.entryRelativePath}`);
    lines.push(`Static modules: ${importGraph.modules.length}`);
    lines.push(`Static source bytes: ${importGraph.totalBytes} (${formatBytes(importGraph.totalBytes)})`);
    lines.push(`Dynamic import targets detected: ${importGraph.dynamicImports.length}`);
    if (importGraph.dynamicImports.length) {
      for (const target of importGraph.dynamicImports) lines.push(`- ${target}`);
    }
    lines.push('');
    lines.push(renderTable(
      ['Rank', 'Module', 'Bytes', 'Human'],
      importGraph.modules.slice(0, 20).map((moduleInfo, index) => [
        index + 1,
        moduleInfo.path,
        moduleInfo.bytes,
        formatBytes(moduleInfo.bytes),
      ]),
    ));
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

printReport();
